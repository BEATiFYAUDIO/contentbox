"""Portable release-policy tests. These do not emulate Apple trust validation."""
import importlib.util
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
