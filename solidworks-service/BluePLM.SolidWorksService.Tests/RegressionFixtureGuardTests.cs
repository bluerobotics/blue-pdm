using System;
using System.Diagnostics;
using System.IO;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The guard is the last thing standing between a diagnostic and a production vault file, so it
    /// is tested against the paths that defeat the naive version rather than only the happy one.
    ///
    /// Every case here was built and run on Windows before it was written down: the junctions are
    /// real junctions made with mklink, the short names come from GetShortPathName, and the escapes
    /// were confirmed to be escapes. Reasoning about Windows path semantics from the source is what
    /// let the earlier holes through, so nothing in this file is asserted on the strength of what
    /// the documentation says a path should do.
    /// </summary>
    [Collection(FixtureRootEnvironmentCollection.Name)]
    public class RegressionFixtureGuardTests : IClassFixture<AdversarialLayout>
    {
        private static readonly string Root = RegressionFixtureGuard.DefaultFixtureRoot;

        private readonly AdversarialLayout _layout;

        public RegressionFixtureGuardTests(AdversarialLayout layout) => _layout = layout;

        #region The original cases

        [Fact]
        public void A_file_inside_the_root_is_allowed()
        {
            var candidate = Path.Combine(Root, FixtureSandbox.OringFixture, "ORING-BUNA-70A.SLDPRT");

            Assert.True(RegressionFixtureGuard.IsInside(candidate, Root));
        }

        [Fact]
        public void The_root_itself_is_allowed()
        {
            Assert.True(RegressionFixtureGuard.IsInside(Root, Root));
        }

        [Fact]
        public void A_path_that_climbs_out_of_the_root_is_refused()
        {
            var escape = Path.Combine(Root, "..", "..", "real-parts", "PRODUCTION.SLDPRT");

            Assert.False(RegressionFixtureGuard.IsInside(escape, Root));
        }

        [Fact]
        public void The_folder_name_appearing_in_an_escaping_path_is_not_enough_to_allow_it()
        {
            var escape = Path.Combine(Root, "..", "..", "real-parts", "PRODUCTION.SLDPRT");

            Assert.True(
                escape.IndexOf("00 - REGRESSION TESTS", StringComparison.OrdinalIgnoreCase) >= 0,
                "This path is exactly the one a substring check accepts; the test is pointless if it does not contain the folder name.");
            Assert.False(RegressionFixtureGuard.IsInside(escape, Root));
        }

        [Fact]
        public void A_sibling_folder_whose_name_starts_with_the_root_is_refused()
        {
            var sibling = Path.Combine(Root + "-EVIL", "PRODUCTION.SLDPRT");

            Assert.False(RegressionFixtureGuard.IsInside(sibling, Root));
        }

        [Fact]
        public void A_path_somewhere_else_entirely_is_refused()
        {
            Assert.False(RegressionFixtureGuard.IsInside(@"C:\Windows\Temp\PRODUCTION.SLDPRT", Root));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("|not|a|path|")]
        public void An_unusable_path_is_refused(string? candidate)
        {
            Assert.False(RegressionFixtureGuard.IsInside(candidate, Root));
        }

        [Fact]
        public void A_junction_planted_inside_the_root_is_refused()
        {
            Assert.True(_layout.JunctionInsideTheRoot, AdversarialLayout.NoJunction);

            Assert.True(
                RegressionFixtureGuard.IsInside(_layout.RealFileInsideRoot, _layout.Root),
                "A genuine file inside the root must still be allowed, or the reparse check is simply refusing everything.");

            Assert.False(RegressionFixtureGuard.IsInside(_layout.FileReachedThroughJunction, _layout.Root));
        }

        [Fact]
        public void The_allowed_root_can_be_pointed_at_a_sandbox()
        {
            var original = Environment.GetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable);
            var sandbox = Path.Combine(Path.GetTempPath(), $"blueplm-guard-{Guid.NewGuid():N}");

            try
            {
                Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, sandbox);

                Assert.True(RegressionFixtureGuard.IsInsideAllowedRoot(Path.Combine(sandbox, "copy.SLDPRT")));
                Assert.False(RegressionFixtureGuard.IsInsideAllowedRoot(Path.Combine(Root, "REAL.SLDPRT")));
            }
            finally
            {
                Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, original);
            }
        }

        #endregion

        #region Shapes that must keep working

        /// <summary>
        /// The three rewrites the guard performs are lossless, so each of these names the same file
        /// as the plain form and has to be allowed. If any of them starts failing, the guard has
        /// become strict in a way that breaks callers rather than in a way that protects anything.
        /// </summary>
        [Fact]
        public void The_harmless_ways_of_spelling_a_path_inside_the_root_are_allowed()
        {
            var file = Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName);

            Assert.True(RegressionFixtureGuard.IsInside(file, _layout.Root), "the plain spelling");
            Assert.True(RegressionFixtureGuard.IsInside(file + @"\", _layout.Root), "a trailing separator");
            Assert.True(RegressionFixtureGuard.IsInside(file, _layout.Root + @"\"), "a trailing separator on the root");
            Assert.True(RegressionFixtureGuard.IsInside(_layout.Root + @"\\" + AdversarialLayout.GenuineFileName, _layout.Root), "a doubled separator");
            Assert.True(RegressionFixtureGuard.IsInside(file.Replace('\\', '/'), _layout.Root), "forward slashes");
            Assert.True(RegressionFixtureGuard.IsInside(file, _layout.Root.Replace('\\', '/')), "forward slashes in the root");
            Assert.True(RegressionFixtureGuard.IsInside(file.ToUpperInvariant(), _layout.Root), "upper case");
            Assert.True(RegressionFixtureGuard.IsInside(file, _layout.Root.ToLowerInvariant()), "a lower case root");
        }

        [Fact]
        public void A_file_that_does_not_exist_yet_is_allowed_inside_the_root()
        {
            var candidate = Path.Combine(_layout.Root, "not-created-yet", "NEW.SLDPRT");

            Assert.True(RegressionFixtureGuard.IsInside(candidate, _layout.Root));
        }

        #endregion

        #region Reparse points: at the root, above it, and below it

        /// <summary>
        /// The hole this suite existed to catch and did not. The ancestor walk used to stop the
        /// moment it reached the allowed root, so the root being a junction - the single case that
        /// redirects every fixture at once - was never looked at.
        /// </summary>
        [Fact]
        public void A_junction_standing_where_the_root_should_be_is_refused()
        {
            Assert.True(_layout.JunctionAsRoot, AdversarialLayout.NoJunction);

            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(_layout.JunctionRoot, "PRODUCTION.txt"), _layout.JunctionRoot),
                "A file under a root that is itself a junction is not inside the root; it is wherever the junction points.");

            Assert.False(
                RegressionFixtureGuard.IsInside(_layout.JunctionRoot, _layout.JunctionRoot),
                "The root being equal to itself is not a reason to skip checking what it is.");
        }

        [Fact]
        public void A_junction_above_the_root_is_refused()
        {
            Assert.True(_layout.JunctionAsRoot, AdversarialLayout.NoJunction);

            var rootBelowTheJunction = Path.Combine(_layout.JunctionRoot, "fixtures");

            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(rootBelowTheJunction, "PART.SLDPRT"), rootBelowTheJunction),
                "Nothing above the root used to be inspected, so a junction there redirected the whole tree unnoticed.");
        }

        /// <summary>
        /// A junction and a symbolic link carry different reparse tags, and the guard is only
        /// allowed to care that there is a reparse point at all. Skipped visibly rather than
        /// silently where the machine will not make one: a security test that quietly passes
        /// because it did nothing is worse than no test.
        /// </summary>
        [RequiresSymbolicLinkFact]
        public void A_symbolic_link_inside_the_root_is_refused()
        {
            Assert.True(_layout.SymbolicLinkInsideTheRoot, "This machine makes symbolic links, so the layout should have one.");

            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, AdversarialLayout.SymlinkName, "PRODUCTION.txt"), _layout.Root));
        }

        [Fact]
        public void A_file_that_does_not_exist_under_a_junction_is_still_refused()
        {
            Assert.True(_layout.JunctionInsideTheRoot, AdversarialLayout.NoJunction);

            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, AdversarialLayout.JunctionName, "nope.txt"), _layout.Root),
                "The junction is what matters, not whether the file beyond it happens to exist yet.");
        }

        #endregion

        #region Extended-length and device prefixes

        /// <summary>
        /// Windows does not collapse ".." underneath \\?\ - it hands the literal path to the object
        /// manager - so Path.GetFullPath returns such a path unchanged. A guard that compared the
        /// result against a root spelled the same way accepted an escape outright.
        /// </summary>
        [Theory]
        [InlineData(@"\..\outside\PRODUCTION.txt")]
        [InlineData(@"\a\..\..\outside\PRODUCTION.txt")]
        [InlineData(@"\..\..\..\..\..\..\..\..\Windows\Temp\x.txt")]
        [InlineData(@"\genuine.txt")]
        public void An_extended_length_path_is_refused_even_when_the_root_is_spelled_the_same_way(string tail)
        {
            var deviceRoot = @"\\?\" + _layout.Root;

            Assert.False(RegressionFixtureGuard.IsInside(deviceRoot + tail, deviceRoot));
        }

        [Fact]
        public void An_extended_length_candidate_against_an_ordinary_root_is_refused()
        {
            Assert.False(
                RegressionFixtureGuard.IsInside(@"\\?\" + Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName), _layout.Root));
        }

        [Fact]
        public void A_device_path_is_refused()
        {
            Assert.False(
                RegressionFixtureGuard.IsInside(@"\\.\" + Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName), _layout.Root));
        }

        [Fact]
        public void An_extended_length_unc_path_is_refused()
        {
            Assert.False(RegressionFixtureGuard.IsInside(@"\\?\UNC\localhost\C$\a\..\b", @"\\?\UNC\localhost\C$\a"));
        }

        [Fact]
        public void The_refusal_of_an_extended_length_path_says_why()
        {
            var deviceRoot = @"\\?\" + _layout.Root;

            var refusal = RegressionFixtureGuard.DescribeRefusal(deviceRoot + @"\..\outside\PRODUCTION.txt", deviceRoot);

            Assert.Contains("extended-length", refusal, StringComparison.OrdinalIgnoreCase);
        }

        #endregion

        #region The working directory

        /// <summary>
        /// A guard whose answer changes with the working directory is not a guard. The old one
        /// resolved a relative candidate against it, so the same string was inside the root or
        /// outside it depending on where the process happened to have been started.
        /// </summary>
        [Fact]
        public void A_relative_candidate_is_refused_from_every_working_directory()
        {
            var previous = Directory.GetCurrentDirectory();

            try
            {
                Directory.SetCurrentDirectory(_layout.Root);
                var fromInsideTheRoot = RegressionFixtureGuard.IsInside(AdversarialLayout.GenuineFileName, _layout.Root);

                Directory.SetCurrentDirectory(_layout.Outside);
                var fromOutsideTheRoot = RegressionFixtureGuard.IsInside(AdversarialLayout.GenuineFileName, _layout.Root);

                Assert.False(fromInsideTheRoot, "A relative path is resolved by the caller, never by the guard.");
                Assert.False(fromOutsideTheRoot);
                Assert.Equal(fromInsideTheRoot, fromOutsideTheRoot);
            }
            finally
            {
                Directory.SetCurrentDirectory(previous);
            }
        }

        [Fact]
        public void A_relative_root_is_refused()
        {
            Assert.False(RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName), "."));
            Assert.False(RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName), @"..\somewhere"));
        }

        [Theory]
        [InlineData(@"C:genuine.txt")]
        [InlineData(@"\genuine.txt")]
        [InlineData(@"genuine.txt")]
        [InlineData(@".\genuine.txt")]
        [InlineData(@"C:")]
        [InlineData(@"\\server")]
        [InlineData(@"\\server\")]
        public void A_path_that_names_no_volume_is_refused(string candidate)
        {
            Assert.False(RegressionFixtureGuard.IsInside(candidate, Root));
        }

        #endregion

        #region Names that are aliases for other names

        /// <summary>
        /// The name Windows itself would use, not one invented here. On .NET Framework
        /// Path.GetFullPath happens to expand these, which is why the old guard judged them
        /// correctly; .NET dropped that expansion, so the correctness was accidental and is now
        /// stated as a rule instead.
        /// </summary>
        [Fact]
        public void The_eight_dot_three_name_windows_generates_is_refused()
        {
            var full = Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName);
            var shortened = AdversarialLayout.ShortNameOf(full);

            Assert.True(
                shortened.IndexOf('~') >= 0,
                $"This volume did not generate an 8.3 name for {full}, so the test cannot exercise anything.");

            Assert.False(RegressionFixtureGuard.IsInside(shortened, _layout.Root), "a short name for the candidate");
            Assert.False(RegressionFixtureGuard.IsInside(full, AdversarialLayout.ShortNameOf(_layout.Root)), "a short name for the root");
        }

        [Theory]
        [InlineData("PROGRA~1")]
        [InlineData("00-REG~1")]
        [InlineData("0-REG~12")]
        [InlineData("PART~1.SLD")]
        [InlineData("A~9")]
        public void A_component_shaped_like_a_short_name_is_refused(string component)
        {
            Assert.False(RegressionFixtureGuard.IsInside(_layout.Root + @"\" + component + @"\PART.SLDPRT", _layout.Root));
        }

        /// <summary>
        /// The sweeper hands the guard the leftovers SolidWorks abandons, and their names are full of
        /// tildes. Refusing them as short names would stop the fixture folder ever being cleaned.
        /// </summary>
        [Theory]
        [InlineData("~$PART.SLDPRT")]
        [InlineData("~$1.SLDPRT")]
        [InlineData("PART.~sldprt")]
        [InlineData("ASSEMBLY.~sldasm")]
        [InlineData("PART~1.SLDPRT")]
        [InlineData("~$ORING-BUNA-70A.SLDDRW")]
        public void A_solidworks_leftover_is_not_mistaken_for_a_short_name(string leftover)
        {
            Assert.True(RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, leftover), _layout.Root));
        }

        [Theory]
        [InlineData("genuine.txt.")]
        [InlineData("genuine.txt ")]
        [InlineData("folder.")]
        public void A_name_windows_would_silently_trim_is_refused(string name)
        {
            Assert.False(RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, name), _layout.Root));
        }

        [Fact]
        public void An_alternate_data_stream_is_refused()
        {
            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName) + ":evil", _layout.Root));
        }

        [Theory]
        [InlineData("*.SLDPRT")]
        [InlineData("part?.SLDPRT")]
        [InlineData("part<1>.SLDPRT")]
        [InlineData("part|pipe.SLDPRT")]
        public void A_wildcard_or_an_illegal_character_is_refused(string name)
        {
            // Concatenated rather than combined: Path.Combine throws on some of these itself.
            Assert.False(RegressionFixtureGuard.IsInside(_layout.Root + @"\" + name, _layout.Root));
        }

        #endregion

        #region Dot segments, siblings and depth

        [Theory]
        [InlineData("..")]
        [InlineData(".")]
        public void A_dot_segment_is_refused_rather_than_resolved(string segment)
        {
            Assert.False(RegressionFixtureGuard.IsInside(Path.Combine(_layout.Root, segment, "genuine.txt"), _layout.Root));
        }

        /// <summary>
        /// The vault really does have folders whose names begin with the root's, so this is not a
        /// theoretical shape. A prefix comparison lets it through; comparing component by component
        /// cannot.
        /// </summary>
        [Fact]
        public void A_sibling_sharing_a_name_prefix_is_refused()
        {
            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(Root + " ARCHIVE", "PRODUCTION.SLDPRT"), Root),
                "'00 - REGRESSION TESTS ARCHIVE' begins with the root's name and is not inside it.");

            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(_layout.SiblingSharingAPrefix, "secret.txt"), _layout.Root),
                "The same sibling, this time one that really exists on disk.");
        }

        [Fact]
        public void A_path_above_the_root_is_refused()
        {
            Assert.False(RegressionFixtureGuard.IsInside(Path.GetDirectoryName(_layout.Root), _layout.Root));
        }

        [Fact]
        public void A_fixture_deeper_than_the_guard_will_walk_is_refused()
        {
            var atTheLimit = _layout.Root;
            for (var level = 1; level <= 12; level++) atTheLimit = Path.Combine(atTheLimit, "L" + level);

            Assert.True(RegressionFixtureGuard.IsInside(atTheLimit, _layout.Root), "twelve levels is the documented limit");
            Assert.False(RegressionFixtureGuard.IsInside(Path.Combine(atTheLimit, "L13"), _layout.Root));
            Assert.False(RegressionFixtureGuard.IsInside(Path.Combine(atTheLimit, "L13", "L14", "deep.SLDPRT"), _layout.Root));
        }

        #endregion

        #region UNC

        [Fact]
        public void A_unc_path_to_the_same_bytes_is_not_the_local_root()
        {
            var unc = @"\\localhost\C$" + _layout.Root.Substring(2);

            Assert.False(
                RegressionFixtureGuard.IsInside(Path.Combine(unc, AdversarialLayout.GenuineFileName), _layout.Root),
                "The share and the drive are different volumes as far as the guard can prove.");
        }

        [Fact]
        public void A_unc_path_climbing_out_of_a_unc_root_is_refused()
        {
            const string uncRoot = @"\\localhost\C$\BluePLM\fixtures";

            Assert.False(RegressionFixtureGuard.IsInside(uncRoot + @"\..\..\real-parts\PRODUCTION.SLDPRT", uncRoot));
            Assert.False(RegressionFixtureGuard.IsInside(@"\\localhost\D$\BluePLM\fixtures\PART.SLDPRT", uncRoot));
        }

        #endregion

        #region What the guard cannot see, it refuses

        /// <summary>
        /// The old check asked File.Exists and Directory.Exists before reading attributes, and both
        /// answer "no" for something they are not allowed to look at - so the branch written to fail
        /// closed on an unreadable path could not be reached. A reserved device name is the cheapest
        /// thing on Windows whose attributes genuinely cannot be read.
        /// </summary>
        [Fact]
        public void A_component_whose_attributes_cannot_be_read_is_refused()
        {
            var exercised = 0;

            foreach (var device in new[] { "NUL", "COM1", "LPT1" })
            {
                var candidate = Path.Combine(_layout.Root, device);
                if (!AttributesAreUnreadable(candidate)) continue;

                exercised++;
                Assert.False(RegressionFixtureGuard.IsInside(candidate, _layout.Root));
                Assert.Contains("attributes", RegressionFixtureGuard.DescribeRefusal(candidate, _layout.Root), StringComparison.OrdinalIgnoreCase);
            }

            Assert.True(
                exercised > 0,
                "Nothing was found whose attributes cannot be read, so the branch that has to fail closed was never reached and this test proves nothing.");
        }

        /// <summary>
        /// Something is there but the guard cannot establish what. Plain absence does not count:
        /// that is the case it is allowed to walk past.
        /// </summary>
        private static bool AttributesAreUnreadable(string path)
        {
            try
            {
                File.GetAttributes(path);
                return false;
            }
            catch (FileNotFoundException)
            {
                return false;
            }
            catch (DirectoryNotFoundException)
            {
                return false;
            }
            catch (Exception)
            {
                return true;
            }
        }

        [Fact]
        public void A_root_that_is_not_usable_as_a_boundary_refuses_everything()
        {
            var file = Path.Combine(_layout.Root, AdversarialLayout.GenuineFileName);

            foreach (var unusableRoot in new string?[] { null, "", "   ", "relative", @"\\?\C:\x", "|nonsense|" })
                Assert.False(RegressionFixtureGuard.IsInside(file, unusableRoot));

            Assert.Contains("root", RegressionFixtureGuard.DescribeRefusal(file, "relative"), StringComparison.OrdinalIgnoreCase);
        }

        #endregion

        #region Roots that are well formed and still useless

        /// <summary>
        /// A malformed root refuses everything, which the guard already had right. A well-formed
        /// but over-broad one did the opposite: "C:\" is absolute, canonical and names a volume, so
        /// it parsed cleanly into zero components - and the containment loop, which compares the
        /// root's components one by one, then had nothing to compare and let the whole drive
        /// through. BLUEPLM_FIXTURE_ROOT is taken verbatim from the environment, so this is one
        /// unset variable or one stray backslash away.
        /// </summary>
        [Theory]
        [InlineData(@"C:\")]
        [InlineData(@"C:/")]
        [InlineData(@"C:\Windows")]
        [InlineData(@"C:\Users")]
        [InlineData(@"\\server\share")]
        [InlineData(@"\\server\share\")]
        public void A_root_too_shallow_to_confine_anything_refuses_everything(string overBroadRoot)
        {
            Assert.NotNull(RegressionFixtureGuard.DescribeRootRefusal(overBroadRoot));

            Assert.False(RegressionFixtureGuard.IsInside(@"C:\Windows\System32\config\SAM", overBroadRoot));
            Assert.False(RegressionFixtureGuard.IsInside(@"C:\Users\someone\Documents\PRODUCTION.SLDPRT", overBroadRoot));
            Assert.False(RegressionFixtureGuard.IsInside(overBroadRoot, overBroadRoot));
        }

        [Fact]
        public void The_refusal_of_an_over_broad_root_says_it_is_the_root_that_is_wrong()
        {
            var refusal = RegressionFixtureGuard.DescribeRefusal(@"C:\Windows\System32\config\SAM", @"C:\");

            Assert.Contains("root", refusal, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("below its volume", refusal, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void The_roots_that_are_actually_used_are_deep_enough()
        {
            Assert.Null(RegressionFixtureGuard.DescribeRootRefusal(RegressionFixtureGuard.DefaultFixtureRoot));
            Assert.Null(RegressionFixtureGuard.DescribeRootRefusal(_layout.Root));
            Assert.Null(RegressionFixtureGuard.DescribeRootRefusal(Path.Combine(Path.GetTempPath(), "blueplm-sandbox")));
        }

        [Fact]
        public void An_over_broad_root_in_the_environment_authorises_nothing()
        {
            var original = Environment.GetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable);

            try
            {
                Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, @"C:\");

                Assert.False(RegressionFixtureGuard.IsInsideAllowedRoot(@"C:\Users\someone\PRODUCTION.SLDPRT"));
                Assert.False(RegressionFixtureGuard.IsInsideAllowedRoot(Path.Combine(Root, "REAL.SLDPRT")));
            }
            finally
            {
                Environment.SetEnvironmentVariable(RegressionFixtureGuard.FixtureRootVariable, original);
            }
        }

        #endregion
    }

    /// <summary>
    /// A real layout on disk with a junction inside the root, a junction standing in for the root,
    /// a symbolic link where the machine allows one, and a sibling folder whose name begins with the
    /// root's.
    ///
    /// Path.GetFullPath cannot see any of it, so nothing short of creating them proves the guard
    /// looks. Built once for the class: mklink costs a process each time.
    /// </summary>
    public sealed class AdversarialLayout : IDisposable
    {
        public const string GenuineFileName = "genuine.SLDPRT";
        public const string JunctionName = "hop";
        public const string SymlinkName = "slink";

        /// <summary>
        /// Said out loud rather than skipped over. mklink /J needs no elevation, so a machine that
        /// cannot make one is unusual enough to be worth failing over: without it the tests below
        /// would pass while checking nothing.
        /// </summary>
        public const string NoJunction =
            "mklink /J could not create a junction here, so the reparse-point check was never exercised.";

        private readonly string _base;

        public AdversarialLayout()
        {
            _base = Path.Combine(Path.GetTempPath(), $"blueplm-adversarial-{Guid.NewGuid():N}");
            Root = Path.Combine(_base, "root");
            Outside = Path.Combine(_base, "outside");
            SiblingSharingAPrefix = Root + " ARCHIVE";
            JunctionRoot = Path.Combine(_base, "junction-root");

            Directory.CreateDirectory(Root);
            Directory.CreateDirectory(Outside);
            Directory.CreateDirectory(SiblingSharingAPrefix);

            RealFileInsideRoot = Path.Combine(Root, GenuineFileName);
            File.WriteAllText(RealFileInsideRoot, "genuine");
            File.WriteAllText(Path.Combine(Outside, "PRODUCTION.txt"), "production");
            File.WriteAllText(Path.Combine(SiblingSharingAPrefix, "secret.txt"), "secret");

            FileReachedThroughJunction = Path.Combine(Root, JunctionName, "PRODUCTION.txt");

            JunctionInsideTheRoot = TryLink("/J", Path.Combine(Root, JunctionName), Outside);
            JunctionAsRoot = TryLink("/J", JunctionRoot, Outside);
            SymbolicLinkInsideTheRoot = TryLink("/D", Path.Combine(Root, SymlinkName), Outside);
        }

        /// <summary>An ordinary folder standing in for the fixture root.</summary>
        public string Root { get; }

        /// <summary>Where a successful escape lands. Never inside <see cref="Root"/>.</summary>
        public string Outside { get; }

        /// <summary>"root ARCHIVE": begins with the root's name, is not inside it.</summary>
        public string SiblingSharingAPrefix { get; }

        /// <summary>A junction used *as* a root, which is the case the guard used to miss.</summary>
        public string JunctionRoot { get; }

        public string RealFileInsideRoot { get; }
        public string FileReachedThroughJunction { get; }

        public bool JunctionInsideTheRoot { get; }
        public bool JunctionAsRoot { get; }

        /// <summary>Symbolic links need a privilege or developer mode, so this one is optional.</summary>
        public bool SymbolicLinkInsideTheRoot { get; }

        /// <summary>The 8.3 spelling Windows itself would use, or the path unchanged.</summary>
        public static string ShortNameOf(string path)
        {
            var buffer = new System.Text.StringBuilder(1024);
            return GetShortPathName(path, buffer, buffer.Capacity) > 0 ? buffer.ToString() : path;
        }

        [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
        private static extern int GetShortPathName(string longPath, System.Text.StringBuilder shortPath, int bufferSize);

        internal static bool TryLink(string flag, string link, string target)
        {
            try
            {
                var process = Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c mklink {flag} \"{link}\" \"{target}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                });

                process?.WaitForExit();
                return process?.ExitCode == 0 && Directory.Exists(link);
            }
            catch (Exception)
            {
                return false;
            }
        }

        public void Dispose()
        {
            try
            {
                // Unlink the reparse points first. Deleting recursively through one would delete
                // what it points at, which is the accident this whole class is about.
                foreach (var name in new[] { Path.Combine(Root, JunctionName), Path.Combine(Root, SymlinkName), JunctionRoot })
                {
                    var directory = new DirectoryInfo(name);
                    if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0) directory.Delete();
                }

                if (Directory.Exists(_base)) Directory.Delete(_base, recursive: true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    /// <summary>
    /// A fact that skips, and says so, when this machine will not create a symbolic link. A
    /// junction needs no privilege; a symbolic link needs elevation or developer mode, so it cannot
    /// be assumed the way <see cref="AdversarialLayout.NoJunction"/> assumes a junction.
    /// </summary>
    public sealed class RequiresSymbolicLinkFactAttribute : FactAttribute
    {
        public RequiresSymbolicLinkFactAttribute()
        {
            if (!SymbolicLinkSupport.Available)
                Skip = "This machine will not create a symbolic link without elevation or developer mode.";
        }
    }

    /// <summary>Asked once per run, by trying it rather than by inspecting a privilege.</summary>
    internal static class SymbolicLinkSupport
    {
        private static readonly Lazy<bool> Supported = new Lazy<bool>(Detect);

        public static bool Available => Supported.Value;

        private static bool Detect()
        {
            var probe = Path.Combine(Path.GetTempPath(), $"blueplm-symlink-probe-{Guid.NewGuid():N}");
            var target = Path.Combine(probe, "target");
            var link = Path.Combine(probe, "link");

            try
            {
                Directory.CreateDirectory(target);
                var made = AdversarialLayout.TryLink("/D", link, target);

                if (made) new DirectoryInfo(link).Delete();
                return made;
            }
            catch (Exception)
            {
                return false;
            }
            finally
            {
                try
                {
                    if (Directory.Exists(probe)) Directory.Delete(probe, recursive: true);
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
