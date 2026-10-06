"""Portable release-policy tests. These do not emulate Apple trust validation."""
import importlib.util
import base64
import json
from pathlib import Path
import plistlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("macos_release", Path(__file__).resolve().parents[1] / "macos-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class Versions(unittest.TestCase):
    def test_beta_and_stable_numeric_mapping(self):
        self.assertEqual(release.versions("0.1.0-beta.12"), ("0.1.0", "2.0.12"))
        self.assertEqual(release.versions("0.1.0-beta"), ("0.1.0", "2.0.0"))
        self.assertEqual(release.versions("0.1.0"), ("0.1.0", "2.0.99"))

    def test_monotonic_release_sequence(self):
        versions = ["0.1.0-beta.11", "0.1.0-beta.12", "0.1.0-beta.98", "0.1.0", "0.1.1-beta.1", "0.2.0-beta.1", "0.99.99", "1.0.0-beta.1"]
        values = [tuple(map(int, release.versions(v)[1].split('.'))) for v in versions]
        self.assertEqual(values, sorted(set(values)))

    def test_unsafe_unsupported_and_overflow_inputs_fail(self):
        for v in ["", "v0.1.0", "0.1.0-rc.1", "0.1.0-beta.0", "0.1.0-beta.99", "99.0.0", "0.100.0",
                  "0.1.100", "01.1.0", "0.1.0\n", '0.1.0;echo bad', '../0.1.0', '0.1.0+build']:
            with self.subTest(version=v), self.assertRaises(ValueError):
                release.versions(v)


class Inventory(unittest.TestCase):
    def test_discovers_unlisted_code_and_ignores_java_magic(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp)
            for name in ['node', 'unexpected.native', 'Example.class']:
                (app / name).write_bytes(bytes.fromhex('cafebabe') + b'test')
            def fake(*args):
                if args[0] == '/usr/bin/file':
                    return 'Java class' if str(args[-1]).endswith('.class') else 'Mach-O 64-bit executable arm64'
                return 'arm64'
            with patch.object(release, 'run', side_effect=fake):
                self.assertEqual([r['path'] for r in release.inventory(app)], ['node', 'unexpected.native'])

    def test_escaping_symlinks_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp) / 'app'; app.mkdir()
            (app / 'escape').symlink_to(Path(tmp))
            with self.assertRaisesRegex(ValueError, 'Symlink escapes'):
                release.inventory(app)

    def test_empty_inventory_fails(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, 'No Mach-O'):
            release.inventory(Path(tmp))


class Notarization(unittest.TestCase):
    def test_accepts_only_matching_accepted_result(self):
        release.require_notarized({'id': 'job', 'status': 'Accepted'}, {'jobId': 'job', 'status': 'Accepted'}, 0)

    def test_rejection_timeout_or_wrong_log_fails(self):
        for status, log_status, code, log_id in [('Invalid', 'Invalid', 0, 'job'),
                                                ('In Progress', 'In Progress', 1, 'job'),
                                                ('Accepted', 'Accepted', 1, 'job'),
                                                ('Accepted', 'Accepted', 0, 'other')]:
            with self.subTest(status=status, code=code, log_id=log_id), self.assertRaises(ValueError):
                release.require_notarized({'id': 'job', 'status': status}, {'jobId': log_id, 'status': log_status}, code)


class Signatures(unittest.TestCase):
    def metadata(self):
        return f'Authority={release.IDENTITY}\nTeamIdentifier={release.TEAM}\nTimestamp=Oct 6 2026\nCodeDirectory flags=0x10000(runtime)\n'

    def test_wrong_team_or_missing_timestamp_or_runtime_fails(self):
        for data in [self.metadata().replace(release.TEAM, 'OTHER'),
                     self.metadata().replace('Timestamp=', 'NoTimestamp='),
                     self.metadata().replace('runtime', 'none')]:
            # Timestamp must be a complete metadata line, never substring-matched.
            with patch.object(release, 'run', return_value=data), self.assertRaises(ValueError):
                release.verify_signature(Path('/app/node'), executable=True)

    def test_rejects_extra_node_entitlements(self):
        def fake(*args):
            if '--entitlements' in args:
                return plistlib.dumps({**release.JIT, 'com.apple.security.get-task-allow': True}).decode()
            return self.metadata()
        with patch.object(release, 'run', side_effect=fake), self.assertRaisesRegex(ValueError, 'Unexpected entitlements'):
            release.verify_signature(Path('/app/node'), executable=True, entitlements=release.JIT)

    def test_codesign_failure_propagates(self):
        with patch.object(release, 'run', side_effect=subprocess.CalledProcessError(1, 'codesign')), self.assertRaises(subprocess.CalledProcessError):
            release.verify_signature(Path('/app/node'))

    def test_inside_out_and_node_only_entitlements(self):
        app = Path('/tmp/Test.app')
        rows = [{'path': str(release.LAUNCHER)}, {'path': str(release.NODE)},
                {'path': 'Contents/Resources/app/unknown/addon.node'}]
        with patch.object(release, 'validate_layout', return_value=rows), \
             patch.object(release, 'nested_bundles', return_value=[]), \
             patch.object(release, 'verify_app', return_value=rows), \
             patch.object(release, 'run') as run:
            release.sign_app(app, 'arm64', '0.1.0-beta.12', '/tmp/private.keychain-db')
        calls = [c.args for c in run.call_args_list]
        self.assertEqual(calls[-1][-1], app)
        self.assertEqual(len(calls), 4)
        self.assertTrue(all('--deep' not in c for c in calls))
        self.assertTrue(all('--timestamp' in c and 'runtime' in c for c in calls))
        entitled = [c for c in calls if '--entitlements' in c]
        self.assertEqual(len(entitled), 1)
        self.assertEqual(entitled[0][-1], app / release.NODE)


class SigningKeychain(unittest.TestCase):
    def run_harness(self, fail_list=False):
        # Run the real signing shell with fake Apple tools and dummy credentials.
        # Stop at sign-app; never perform signing or contact Apple's services.
        with tempfile.TemporaryDirectory(prefix='signing test ') as tmp:
            root = Path(tmp)
            scripts = root / 'scripts'; scripts.mkdir()
            source = Path(__file__).resolve().parents[1] / 'sign-notarize-macos.sh'
            shutil.copyfile(source, scripts / source.name)
            original = ['/Users/runner/Library/Keychains/login.keychain-db',
                        '/Library/Keychains/System.keychain', '/tmp/keychain with spaces.keychain-db']
            state = root / 'state.json'
            state.write_text(json.dumps({'search': original, 'calls': []}))
            fake_bin = root / 'bin'; fake_bin.mkdir()
            security = fake_bin / 'security'
            security.write_text(f'#!{sys.executable}\n' + '''
import json, os, sys
from pathlib import Path
p = Path(os.environ['TEST_KEYCHAIN_STATE'])
s = json.loads(p.read_text())
args = sys.argv[1:]
s['calls'].append(args[0])
status = 0
if args[0] == 'list-keychains':
    if '-s' in args:
        if os.environ['TEST_FAIL_LIST'] == '1':
            status = 43
        else:
            s['search'] = args[args.index('-s') + 1:]
    else:
        for path in s['search']:
            print('    ' + json.dumps(path))
elif args[0] == 'create-keychain':
    Path(args[-1]).touch()
elif args[0] == 'delete-keychain':
    s['search'] = [path for path in s['search'] if path != args[-1]]
elif args[0] == 'find-identity':
    print('Developer ID Application: Hwy 11 Entertainment Inc (KYAPD65KRD)')
p.write_text(json.dumps(s))
sys.exit(status)
''')
            security.chmod(0o755)
            for name, value in [('uname', 'Darwin'), ('openssl', 'dummy-keychain-password')]:
                tool = fake_bin / name
                tool.write_text(f'#!/bin/sh\nprintf "%s\\n" "{value}"\n')
                tool.chmod(0o755)
            (scripts / 'macos-release.py').write_text('''
import json, os, sys
from pathlib import Path
if sys.argv[1] == 'sign-app':
    p = Path(os.environ['TEST_KEYCHAIN_STATE'])
    s = json.loads(p.read_text())
    s['at_sign'] = s['search'][:]
    s['keychain'] = sys.argv[sys.argv.index('--keychain') + 1]
    p.write_text(json.dumps(s))
    sys.exit(73)  # Exercise cleanup after a signing failure.
''')
            dummy = base64.b64encode(b'dummy test material').decode()
            env = {**os.environ, 'PATH': f'{fake_bin}{os.pathsep}{os.environ["PATH"]}',
                   'RUNNER_TEMP': str(root), 'GITHUB_ENV': str(root / 'github-env'),
                   'TEST_KEYCHAIN_STATE': str(state), 'TEST_FAIL_LIST': str(int(fail_list)),
                   'APPLE_CERTIFICATE_P12': dummy, 'APPLE_API_KEY_P8': dummy,
                   'APPLE_CERTIFICATE_PASSWORD': 'dummy-password', 'APPLE_API_KEY_ID': 'dummy-id',
                   'APPLE_API_ISSUER_ID': 'dummy-issuer', 'APPLE_TEAM_ID': release.TEAM}
            result = subprocess.run(['bash', str(scripts / source.name), 'arm64', '0.1.0-beta.12'],
                                    env=env, capture_output=True, text=True)
            self.assertNotIn(dummy, result.stdout + result.stderr)
            self.assertNotIn('dummy-password', result.stdout + result.stderr)
            data = json.loads(state.read_text())
            self.assertEqual(data['search'], original)
            self.assertIn('delete-keychain', data['calls'])
            self.assertEqual(list(root.glob('certifyd-signing.*')), [])
            return result, data, original

    def test_preserves_search_list_at_signing_and_cleans_up_on_failure(self):
        result, data, original = self.run_harness()
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assertEqual(data['at_sign'], [data['keychain'], *original])

    def test_search_list_failure_stops_before_signing(self):
        result, data, _ = self.run_harness(fail_list=True)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('at_sign', data)
        self.assertNotIn('import', data['calls'])


@unittest.skipUnless(shutil.which('cc'), 'C compiler required')
class Launcher(unittest.TestCase):
    def test_path_arguments_and_move(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = root / 'Certifyd Core.app'
            macos = app / 'Contents/MacOS'; macos.mkdir(parents=True)
            resources = app / 'Contents/Resources'; resources.mkdir()
            script = resources / 'CertifydCoreLauncher.sh'
            script.write_text('printf "%s\\n" "$@"\n')
            source = Path(__file__).resolve().parents[2] / 'packaging/macos/CertifydCoreLauncher.c'
            args = ['cc', '-Wall', '-Wextra', '-Werror', str(source), '-o', str(macos / 'CertifydCoreLauncher')]
            if sys.platform != 'darwin':
                # Test path/exec/argument handling on Linux; not a Mach-O build test.
                include = root / 'mach-o'; include.mkdir()
                (include / 'dyld.h').write_text('#include <stdint.h>\nint _NSGetExecutablePath(char *, uint32_t *);\n')
                stub = root / 'dyld.c'
                stub.write_text('#include <stdint.h>\n#include <unistd.h>\nint _NSGetExecutablePath(char *p,uint32_t *s){ssize_t n=readlink("/proc/self/exe",p,*s-1);if(n<0)return -1;p[n]=0;return 0;}\n')
                args += ['-I', str(root), str(stub)]
            subprocess.run(args, check=True, capture_output=True)
            injected = root / 'injected.sh'; injected.write_text('exit 42\n')
            env = {**os.environ, 'BASH_ENV': str(injected)}
            for location in [app, root / 'Moved Core.app']:
                if location != app:
                    app.rename(location)
                actual = subprocess.check_output([str(location / 'Contents/MacOS/CertifydCoreLauncher'), '--lan', 'argument with spaces'], env=env, cwd='/', text=True)
                self.assertEqual(actual, '--lan\nargument with spaces\n')
            (location / 'Contents/Resources/CertifydCoreLauncher.sh').unlink()
            result = subprocess.run([str(location / 'Contents/MacOS/CertifydCoreLauncher')], capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
