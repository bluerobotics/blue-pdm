using System;
using System.IO;
using System.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The cleanup has to survive the runs that do not finish, so these tests do not exercise the
    /// happy path alone: they throw mid-write, fabricate the wreckage a killed process leaves, and
    /// hold a fixture locked so the restore cannot complete.
    ///
    /// All of it happens in a throwaway %TEMP% tree. Nothing here touches the vault.
    /// </summary>
    public class FixtureRestoreTests
    {
        private const string FixtureName = "PART.SLDPRT";
        private const string OriginalContents = "the original fixture bytes";
        private const string ModifiedContents = "half-written garbage from a run that died";

        #region Restore on every exit path

        [Fact]
        public void A_restore_puts_back_the_bytes_the_attribute_and_removes_the_backup()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            var backup = FixtureBackup.Create(fixture, root.Root);
            FixtureFile.ClearReadOnly(fixture);
            File.WriteAllText(fixture, ModifiedContents);
            Assert.NotEqual(originalHash, FixtureFile.ComputeSha256(fixture));

            var result = backup.Restore();

            Assert.True(result.Restored, result.Message);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
            Assert.True(new FileInfo(fixture).IsReadOnly, "The read-only attribute is part of the fixture's state.");
            Assert.False(File.Exists(backup.BackupPath));
        }

        [Fact]
        public void An_exception_thrown_mid_write_still_restores_the_fixture()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            Action writeThatBlowsUp = () =>
            {
                using var backup = FixtureBackup.Create(fixture, root.Root);
                FixtureFile.ClearReadOnly(fixture);
                File.WriteAllText(fixture, ModifiedContents);
                throw new InvalidOperationException("the write blew up half way through");
            };

            var thrown = Assert.Throws<InvalidOperationException>(writeThatBlowsUp);

            Assert.Equal("the write blew up half way through", thrown.Message);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
            Assert.True(new FileInfo(fixture).IsReadOnly);
            Assert.False(File.Exists(fixture + FixtureBackup.BackupSuffix));
        }

        [Fact]
        public void Restoring_twice_is_harmless()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            using var backup = FixtureBackup.Create(fixture, root.Root);
            FixtureFile.ClearReadOnly(fixture);
            File.WriteAllText(fixture, ModifiedContents);

            Assert.True(backup.Restore().Restored);
            Assert.True(backup.Restore().Restored);
            Assert.True(backup.IsRestored);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
        }

        [Fact]
        public void A_fixture_that_was_never_written_to_is_left_exactly_as_it_was()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents, readOnly: false);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            using var backup = FixtureBackup.Create(fixture, root.Root);
            Assert.True(backup.Restore().Restored);

            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
            Assert.False(new FileInfo(fixture).IsReadOnly, "A writable fixture must not come back read-only.");
            Assert.False(File.Exists(backup.BackupPath));
        }

        [Fact]
        public void Backing_up_over_an_orphan_is_refused_because_the_orphan_is_the_original()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            LeaveTheWreckageOfAKilledRun(fixture);

            var refusal = Assert.Throws<InvalidOperationException>(() => FixtureBackup.Create(fixture, root.Root));

            Assert.Contains("interrupted", refusal.Message);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture + FixtureBackup.BackupSuffix));
        }

        [Fact]
        public void A_backup_outside_the_allowed_root_is_refused()
        {
            using var root = new SyntheticFixtureRoot();
            using var elsewhere = new SyntheticFixtureRoot();
            var outsider = elsewhere.WriteFixture(FixtureName, OriginalContents);

            Assert.Throws<InvalidOperationException>(() => FixtureBackup.Create(outsider, root.Root));
            Assert.False(File.Exists(outsider + FixtureBackup.BackupSuffix));
        }

        #endregion

        #region A restore that cannot complete

        [Fact]
        public void A_restore_that_cannot_complete_fails_loudly_and_keeps_the_backup()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            using var backup = FixtureBackup.Create(fixture, root.Root);
            FixtureFile.ClearReadOnly(fixture);
            File.WriteAllText(fixture, ModifiedContents);

            FixtureRestoreResult blocked;
            using (new FileStream(fixture, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                blocked = backup.Restore();
            }

            Assert.False(blocked.Restored, "A locked fixture cannot have been restored.");
            Assert.Contains(FixtureName, blocked.Message);
            Assert.True(File.Exists(backup.BackupPath), "The only copy of the original must be kept.");

            // The failure is not terminal: once the lock is gone the restore can be retried.
            var retried = backup.Restore();
            Assert.True(retried.Restored, retried.Message);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
        }

        [Fact]
        public void A_missing_backup_over_a_modified_fixture_is_reported_as_a_failure()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);

            var backup = FixtureBackup.Create(fixture, root.Root);
            FixtureFile.ClearReadOnly(fixture);
            File.WriteAllText(fixture, ModifiedContents);

            FixtureFile.ClearReadOnly(backup.BackupPath);
            File.Delete(backup.BackupPath);

            var result = backup.Restore();

            Assert.False(result.Restored);
            Assert.Contains("source control", result.Message);
        }

        #endregion

        #region The interrupted run

        [Fact]
        public void An_interrupted_run_is_repaired_by_the_next_preflight_sweep()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            LeaveTheWreckageOfAKilledRun(fixture);

            var sweep = FixtureSweeper.Sweep(root.Root);

            Assert.True(sweep.InterruptedRunDetected, "The orphaned backup is the evidence a run did not finish.");
            Assert.True(sweep.IsClean, string.Join(" | ", sweep.Failures));
            Assert.Single(sweep.Restored);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
            Assert.True(new FileInfo(fixture).IsReadOnly, "The killed run had cleared the attribute; the sweep restores it.");
            Assert.False(File.Exists(fixture + FixtureBackup.BackupSuffix));
        }

        [Fact]
        public void A_sweep_of_an_untouched_folder_reports_nothing_and_changes_nothing()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            var sweep = FixtureSweeper.Sweep(root.Root);

            Assert.False(sweep.InterruptedRunDetected);
            Assert.False(sweep.ActedOnAnything);
            Assert.True(sweep.IsClean);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
            Assert.True(new FileInfo(fixture).IsReadOnly);
        }

        [Fact]
        public void A_fixture_deleted_by_an_interrupted_run_is_put_back()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            File.Copy(fixture, fixture + FixtureBackup.BackupSuffix);
            FixtureFile.ClearReadOnly(fixture);
            File.Delete(fixture);

            var sweep = FixtureSweeper.Sweep(root.Root);

            Assert.True(sweep.IsClean, string.Join(" | ", sweep.Failures));
            Assert.True(File.Exists(fixture));
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
            Assert.True(new FileInfo(fixture).IsReadOnly);
        }

        [Fact]
        public void A_backup_the_sweep_cannot_restore_is_kept_and_reported()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);

            LeaveTheWreckageOfAKilledRun(fixture);

            FixtureSweepReport sweep;
            using (new FileStream(fixture, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                sweep = FixtureSweeper.Sweep(root.Root);
            }

            Assert.True(sweep.InterruptedRunDetected);
            Assert.False(sweep.IsClean, "A folder with an unrestored fixture in it is not clean.");
            Assert.Contains(sweep.Failures, failure => failure.Contains(FixtureName));
            Assert.True(File.Exists(fixture + FixtureBackup.BackupSuffix), "The backup is the only original left.");

            Assert.True(FixtureSweeper.Sweep(root.Root).IsClean, "The next sweep, unblocked, should finish the job.");
        }

        #endregion

        #region SolidWorks leftovers

        [Theory]
        [InlineData("~$PART.SLDPRT")]
        [InlineData("PART.~sldprt")]
        [InlineData("ASSEMBLY.~sldasm")]
        [InlineData("DRAWING.~slddrw")]
        [InlineData("PART.swbak")]
        [InlineData("PART.SLDPRT.bak")]
        public void The_sweep_deletes_leftovers(string leftoverName)
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);
            var leftover = root.WriteFixture(leftoverName, "left behind by a crash");

            var sweep = FixtureSweeper.Sweep(root.Root);

            Assert.True(sweep.IsClean, string.Join(" | ", sweep.Failures));
            Assert.False(File.Exists(leftover), $"{leftoverName} should have been swept.");
            Assert.True(File.Exists(fixture), "The fixture itself is not a leftover.");
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
        }

        [Fact]
        public void The_sweep_leaves_the_fixtures_themselves_alone()
        {
            using var root = new SyntheticFixtureRoot();
            var part = root.WriteFixture("PART.SLDPRT", OriginalContents);
            var drawing = root.WriteFixture("DRAWING.SLDDRW", OriginalContents);

            var sweep = FixtureSweeper.Sweep(root.Root);

            Assert.False(sweep.ActedOnAnything);
            Assert.True(File.Exists(part));
            Assert.True(File.Exists(drawing));
        }

        #endregion

        #region A real fixture copy, end to end

        [RequiresFixtureFact(FixtureSandbox.ScrewFixture)]
        public void A_real_read_only_fixture_survives_a_write_that_throws()
        {
            using var sandbox = FixtureSandbox.Create(FixtureSandbox.ScrewFixture);
            var fixture = Directory.GetFiles(sandbox.Root, "*.SLDPRT").First();
            var originalHash = FixtureFile.ComputeSha256(fixture);
            Assert.True(new FileInfo(fixture).IsReadOnly);

            Action crashMidWrite = () =>
            {
                using var backup = FixtureBackup.Create(fixture, sandbox.Root);
                FixtureFile.ClearReadOnly(fixture);
                File.AppendAllText(fixture, "corruption");
                throw new InvalidOperationException("simulating a crash mid-write");
            };

            Assert.Throws<InvalidOperationException>(crashMidWrite);

            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
            Assert.True(new FileInfo(fixture).IsReadOnly);
            Assert.Empty(Directory.GetFiles(sandbox.Root, "*" + FixtureBackup.BackupSuffix));
        }

        #endregion

        /// <summary>
        /// Exactly what a hard-killed run leaves on disk: a backup that still carries the fixture's
        /// original attribute, next to a fixture that has been modified and left writable.
        /// </summary>
        private static void LeaveTheWreckageOfAKilledRun(string fixture)
        {
            File.Copy(fixture, fixture + FixtureBackup.BackupSuffix);
            FixtureFile.ClearReadOnly(fixture);
            File.WriteAllText(fixture, ModifiedContents);
        }

        /// <summary>
        /// A fixture folder made from nothing, so these tests need neither SolidWorks nor the vault.
        /// </summary>
        private sealed class SyntheticFixtureRoot : IDisposable
        {
            public SyntheticFixtureRoot()
            {
                Root = Path.Combine(Path.GetTempPath(), $"blueplm-fixture-{Guid.NewGuid():N}");
                Directory.CreateDirectory(Root);
            }

            public string Root { get; }

            /// <summary>Write a file into the root, read-only by default as every real fixture is.</summary>
            public string WriteFixture(string name, string contents, bool readOnly = true)
            {
                var path = Path.Combine(Root, name);
                File.WriteAllText(path, contents);
                new FileInfo(path).IsReadOnly = readOnly;
                return path;
            }

            public void Dispose()
            {
                if (!Directory.Exists(Root)) return;

                foreach (var file in Directory.GetFiles(Root, "*", SearchOption.AllDirectories))
                    FixtureFile.ClearReadOnly(file);

                try
                {
                    Directory.Delete(Root, recursive: true);
                }
                catch (IOException)
                {
                }
                catch (UnauthorizedAccessException)
                {
                }
            }
        }
    }
}
