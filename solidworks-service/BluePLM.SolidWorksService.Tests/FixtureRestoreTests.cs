using System;
using System.Diagnostics;
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

        [Theory]
        [InlineData("PART.SLDPRT.bak")]
        [InlineData("before-the-write.bak")]
        public void The_sweep_keeps_a_hand_made_backup(string name)
        {
            // ".bak" is what a person types when copying a file aside, not something SolidWorks
            // writes - SolidWorks writes ".swbak". The sweep used to delete both, so a manual
            // before-and-after copy taken to check a fixture disappeared the next time a probe ran.
            using var root = new SyntheticFixtureRoot();
            root.WriteFixture(FixtureName, OriginalContents);
            var handMade = root.WriteFixture(name, "a copy somebody took on purpose");

            var sweep = FixtureSweeper.Sweep(root.Root);

            Assert.True(sweep.IsClean, string.Join(" | ", sweep.Failures));
            Assert.True(File.Exists(handMade), $"{name} is not a SolidWorks leftover and is not the sweep's to delete.");
            Assert.DoesNotContain(sweep.Deleted, deleted => deleted.EndsWith(name, StringComparison.OrdinalIgnoreCase));
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

        #region Two probes in one folder

        /// <summary>
        /// The sweep and a live backup used to be indistinguishable, and the sweep acted first.
        /// A second probe starting in a folder the first was writing in would restore the first
        /// probe's backup over the fixture mid-write and then delete it; the first probe's own
        /// restore then took the "backup is gone" branch and reported a hash mismatch with no copy
        /// of the original left anywhere.
        /// </summary>
        [Fact]
        public void A_backup_a_live_probe_is_holding_is_not_swept_away_underneath_it()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            using var backup = FixtureBackup.Create(fixture, root.Root);
            FixtureFile.ClearReadOnly(fixture);
            File.WriteAllText(fixture, ModifiedContents);

            var sweep = FixtureSweeper.Sweep(root.Root, owner => true);

            Assert.False(sweep.IsClean, "A folder another probe is writing in is not one this run may use.");
            Assert.Contains(sweep.Failures, failure => failure.Contains("still running"));
            Assert.Empty(sweep.Restored);
            Assert.True(File.Exists(backup.BackupPath), "The live probe's only copy of the original must survive.");

            // And the run that owns it can still finish, because its backup is untouched.
            var restored = backup.Restore();
            Assert.True(restored.Restored, restored.Message);
            Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
        }

        [Fact]
        public void A_backup_whose_owner_is_gone_is_still_treated_as_wreckage_and_restored()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var originalHash = FixtureFile.ComputeSha256(fixture);

            using (FixtureBackup.Create(fixture, root.Root))
            {
                FixtureFile.ClearReadOnly(fixture);
                File.WriteAllText(fixture, ModifiedContents);

                var sweep = FixtureSweeper.Sweep(root.Root, owner => false);

                Assert.True(sweep.InterruptedRunDetected);
                Assert.True(sweep.IsClean, string.Join(" | ", sweep.Failures));
                Assert.Single(sweep.Restored);
                Assert.Equal(originalHash, FixtureFile.ComputeSha256(fixture));
                Assert.Empty(Directory.GetFiles(root.Root, "*" + FixtureBackup.BackupSuffix + "*"));
            }
        }

        [Fact]
        public void A_second_backup_of_the_same_fixture_is_refused_rather_than_taken()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);

            using var first = FixtureBackup.Create(fixture, root.Root);

            var refusal = Assert.Throws<InvalidOperationException>(() => FixtureBackup.Create(fixture, root.Root));

            Assert.Contains("already exists", refusal.Message);
            Assert.True(File.Exists(first.BackupPath));
        }

        [Fact]
        public void A_claim_left_behind_without_its_backup_is_cleared_once_its_owner_is_gone()
        {
            // The window between claiming a fixture and copying it is small, but a kill inside it
            // leaves a claim with nothing behind it, and that must not block every later run.
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);
            var strandedClaim = fixture + FixtureBackup.BackupSuffix + FixtureBackup.OwnerSuffix;

            new FixtureBackupOwner(4242, "2026-08-06T00:00:00.0000000Z", Environment.MachineName).WriteTo(strandedClaim);

            Assert.False(FixtureSweeper.Sweep(root.Root, owner => true).IsClean, "A live owner's claim is left alone.");
            Assert.True(File.Exists(strandedClaim));

            var sweep = FixtureSweeper.Sweep(root.Root, owner => false);

            Assert.True(sweep.IsClean, string.Join(" | ", sweep.Failures));
            Assert.False(File.Exists(strandedClaim));
            Assert.True(File.Exists(fixture));
        }

        [Fact]
        public void A_backup_taken_here_records_this_process_as_its_owner()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);

            using var backup = FixtureBackup.Create(fixture, root.Root);

            var owner = FixtureBackupOwner.ReadFrom(backup.OwnerPath);

            Assert.NotNull(owner);
            Assert.Equal(Process.GetCurrentProcess().Id, owner!.ProcessId);
            Assert.Equal(Environment.MachineName, owner.MachineName);
            Assert.True(owner.IsStillRunning(), "This test is the owner, and it is running.");
        }

        [Fact]
        public void An_owner_that_cannot_be_judged_is_assumed_to_be_alive()
        {
            // Every unanswerable question resolves towards keeping the backup: mistaking a live
            // owner for a dead one destroys the only copy of a fixture.
            Assert.True(new FixtureBackupOwner(1, "2026-08-06T00:00:00.0000000Z", "SOME-OTHER-MACHINE").IsStillRunning());
            Assert.True(new FixtureBackupOwner(0, "2026-08-06T00:00:00.0000000Z", Environment.MachineName).IsStillRunning());
            Assert.True(new FixtureBackupOwner(4242, string.Empty, Environment.MachineName).IsStillRunning());
        }

        [Fact]
        public void An_owner_whose_pid_was_recycled_is_not_mistaken_for_the_original()
        {
            // This process's id, but a start time that is not this process's: a different process
            // wearing a reused number, and its claim is not on anything here.
            var recycled = new FixtureBackupOwner(
                Process.GetCurrentProcess().Id,
                "1999-01-01T00:00:00.0000000Z",
                Environment.MachineName);

            Assert.False(recycled.IsStillRunning());
        }

        #endregion

        #region Roots that cannot confine anything

        [Theory]
        [InlineData(@"C:\")]
        [InlineData(@"C:\Windows")]
        [InlineData(@"\\server\share")]
        public void A_root_too_broad_to_be_a_boundary_is_swept_by_nothing(string overBroadRoot)
        {
            // "C:\" parses as a perfectly good path with zero components below its volume, so the
            // containment check compares nothing and authorises the entire drive.
            var sweep = FixtureSweeper.Sweep(overBroadRoot, owner => false);

            Assert.False(sweep.IsClean);
            Assert.Empty(sweep.Deleted);
            Assert.Empty(sweep.Restored);
            Assert.Contains(sweep.Failures, failure => failure.Contains("usable fixture root"));
        }

        [Fact]
        public void A_backup_under_a_root_too_broad_to_be_a_boundary_is_refused()
        {
            using var root = new SyntheticFixtureRoot();
            var fixture = root.WriteFixture(FixtureName, OriginalContents);

            Assert.Throws<InvalidOperationException>(() => FixtureBackup.Create(fixture, @"C:\"));
            Assert.False(File.Exists(fixture + FixtureBackup.BackupSuffix));
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
