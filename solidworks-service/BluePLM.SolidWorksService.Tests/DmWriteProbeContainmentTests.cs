using System;
using System.IO;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Tests that mutate BLUEPLM_FIXTURE_ROOT. The variable is process-wide, so they are put in one
    /// collection rather than left to overwrite each other's root while running side by side.
    /// </summary>
    [CollectionDefinition(Name)]
    public sealed class FixtureRootEnvironmentCollection
    {
        public const string Name = "fixture-root-environment";
    }

    /// <summary>
    /// What <c>--dm-probe</c> does to the folder it is pointed at when it has not been asked to
    /// write to it.
    ///
    /// The help text has always said the probe is "read-only unless --allow-write is also passed",
    /// and it was not: the pre-flight sweep ran before the write flag was ever looked at, so every
    /// invocation - including the plain read-only one an operator would reach for first - deleted
    /// matching files throughout whatever <c>ResolveAllowedRoot</c> returned, which by default is
    /// the live vault.
    ///
    /// These run the probe for real, against a throwaway root, with no licence key. The probe stops
    /// at the missing key either way; the question is what it has already done to the folder by the
    /// time it gets there.
    /// </summary>
    [Collection(FixtureRootEnvironmentCollection.Name)]
    public class DmWriteProbeContainmentTests
    {
        private const string LeftoverName = "~$LEFTOVER.SLDPRT";
        private const string FixtureName = "PART.SLDPRT";

        [Fact]
        public void A_read_only_probe_deletes_nothing_from_the_folder_it_is_pointed_at()
        {
            using var root = new ProbeRoot();

            var exitCode = root.RunProbe(allowWrite: false);

            Assert.Equal(1, exitCode);
            Assert.True(File.Exists(root.Leftover), "A read-only run must not delete anything, leftover or not.");
            Assert.True(File.Exists(root.Fixture));
            Assert.Equal(root.FixtureHash, FixtureFile.ComputeSha256(root.Fixture));
        }

        [Fact]
        public void A_read_only_probe_does_not_restore_a_backup_another_run_left_behind()
        {
            using var root = new ProbeRoot();

            // Wreckage from an interrupted write. Putting it back is a write, and a read-only run
            // has not been given permission to make one.
            File.Copy(root.Fixture, root.Fixture + FixtureBackup.BackupSuffix);
            FixtureFile.ClearReadOnly(root.Fixture);
            File.WriteAllText(root.Fixture, "half-written garbage");
            var modifiedHash = FixtureFile.ComputeSha256(root.Fixture);

            root.RunProbe(allowWrite: false);

            Assert.Equal(modifiedHash, FixtureFile.ComputeSha256(root.Fixture));
            Assert.True(File.Exists(root.Fixture + FixtureBackup.BackupSuffix));
        }

        [Fact]
        public void A_probe_allowed_to_write_still_sweeps_the_folder_first()
        {
            // The counterpart. Moving the sweep behind the flag would be no use if it stopped
            // happening at all: an interrupted run can only be cleaned up by the next one that is
            // allowed to write.
            using var root = new ProbeRoot();

            root.RunProbe(allowWrite: true);

            Assert.False(File.Exists(root.Leftover), "A write run cleans the folder it is about to write in.");
            Assert.True(File.Exists(root.Fixture));
            Assert.Equal(root.FixtureHash, FixtureFile.ComputeSha256(root.Fixture));
        }

        [Fact]
        public void A_probe_allowed_to_write_outside_the_root_sweeps_nothing()
        {
            using var root = new ProbeRoot();
            using var elsewhere = new ProbeRoot(pointTheVariableHere: false);

            // The file is refused for being outside the root, and the refusal has to come before
            // anything is done to the root.
            var exitCode = root.RunProbe(allowWrite: true, filePath: elsewhere.Fixture);

            Assert.Equal(1, exitCode);
            Assert.True(File.Exists(root.Leftover), "Nothing should have been swept for a run that was refused.");
        }

        /// <summary>
        /// A throwaway fixture root with one fixture and one SolidWorks leftover in it, pointed at
        /// by BLUEPLM_FIXTURE_ROOT for the life of the test.
        /// </summary>
        private sealed class ProbeRoot : IDisposable
        {
            private readonly string? _previousRoot;
            private readonly bool _pointed;

            public ProbeRoot(bool pointTheVariableHere = true)
            {
                Root = Path.Combine(Path.GetTempPath(), $"blueplm-probe-root-{Guid.NewGuid():N}");
                Directory.CreateDirectory(Root);

                Fixture = Path.Combine(Root, FixtureName);
                File.WriteAllText(Fixture, "the original fixture bytes");
                new FileInfo(Fixture).IsReadOnly = true;
                FixtureHash = FixtureFile.ComputeSha256(Fixture);

                Leftover = Path.Combine(Root, LeftoverName);
                File.WriteAllText(Leftover, "abandoned by SolidWorks");

                _pointed = pointTheVariableHere;
                if (!_pointed) return;

                _previousRoot = Environment.GetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable);
                Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, Root);
            }

            public string Root { get; }
            public string Fixture { get; }
            public string Leftover { get; }
            public string FixtureHash { get; }

            /// <summary>
            /// Runs the probe with no licence key, so it reports the missing key and stops without
            /// ever loading Document Manager. Everything under test happens before that point.
            /// </summary>
            public int RunProbe(bool allowWrite, string? filePath = null) =>
                DmWriteProbe.Run(new ProbeOptions
                {
                    FilePath = filePath ?? Fixture,
                    AllowWrite = allowWrite,
                    LicenseKey = null,
                });

            public void Dispose()
            {
                if (_pointed)
                    Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, _previousRoot);

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
