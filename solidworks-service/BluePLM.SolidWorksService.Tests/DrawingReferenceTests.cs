using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Reads real drawings' references through Document Manager, with SolidWorks not running.
    ///
    /// This is the suite the search-filter defect needed. Every reference read in the service
    /// returned an empty array, instantly, for as long as the wrong bitmask was in place - and an
    /// empty array is indistinguishable from a file that genuinely has no references, so nothing
    /// failed. A test that opens a drawing known to reference a part and asserts the part comes back
    /// fails the moment the bitmask is wrong again.
    ///
    /// The fixtures are copied to %TEMP% by <see cref="FixtureSandbox"/> and every open here is
    /// read-only, so the vault copies are never handed to the code under test.
    /// </summary>
    public class DrawingReferenceTests : IClassFixture<DocumentManagerFixtures>
    {
        private const string Oring = FixtureSandbox.OringFixture;
        private const string Screw = FixtureSandbox.ScrewFixture;
        private const string NestedAssembly = FixtureSandbox.NestedAssemblyFixture;

        private const string OringPart = "ORING-BUNA-70A.SLDPRT";

        /// <summary>
        /// Subfolders|ForPart|ForDrawing|ForAssembly - document TYPE flags with no behaviour flag.
        /// This is what production passed for years, and it never sets ExternalReference.
        /// </summary>
        private const SwDmSearchFilter TypeFlagsOnly =
            SwDmSearchFilter.Subfolders |
            SwDmSearchFilter.ForPart |
            SwDmSearchFilter.ForDrawing |
            SwDmSearchFilter.ForAssembly;

        private readonly DocumentManagerFixtures _fixtures;

        public DrawingReferenceTests(DocumentManagerFixtures fixtures) => _fixtures = fixtures;

        #region The defect itself

        [DocumentManagerFixtureFact(Oring)]
        public void A_drawing_resolves_the_part_it_references()
        {
            var drawing = _fixtures.PathTo(Oring, "ORING-BUNA-70A-265.SLDDRW");

            var read = _fixtures.Api.ReadReferences(drawing);

            Assert.Null(read.Failure?.Error);
            Assert.Equal(DocumentManagerAPI.ReferenceReadStatus.Resolved, read.External.Status);
            Assert.Contains(
                read.External.References,
                reference => NameMatches(reference.Path, OringPart));
        }

        [DocumentManagerFixtureFact(Oring)]
        public void The_production_filters_are_never_worse_than_the_type_flags_alone()
        {
            var drawing = _fixtures.PathTo(Oring, "ORING-BUNA-70A-265.SLDDRW");

            var production = _fixtures.Api.ReadReferences(drawing);
            var typeFlagsOnly = _fixtures.Api.ReadReferences(drawing, TypeFlagsOnly);

            // Deliberately ">=" and named for it. "The production filters find what the type flags
            // cannot" would be a stronger claim than the assertion makes - it passes when the two
            // sets are equivalent - and pinning the strict inequality would pin vendor behaviour
            // this suite does not own. What is worth holding is that the bitmask production ships
            // with is never the worse of the two, which is exactly what failed before.
            Assert.True(
                production.External.References.Count >= typeFlagsOnly.External.References.Count,
                $"Filters {(int)SwDmConstants.ReferenceResolutionFilters} " +
                $"({SwDmConstants.ReferenceResolutionFilters}) found " +
                $"{production.External.References.Count} references, but filters {(int)TypeFlagsOnly} " +
                $"({TypeFlagsOnly}) found {typeFlagsOnly.External.References.Count}.");

            Assert.NotEmpty(production.External.References);
        }

        [DocumentManagerFixtureFact(Oring)]
        public void A_part_with_no_external_references_reports_resolved_rather_than_unavailable()
        {
            var part = _fixtures.PathTo(Oring, OringPart);

            var read = _fixtures.Api.ReadReferences(part);

            // The distinction this suite exists to protect: an answered read that found nothing is
            // not the same fact as a read nothing answered, and only the first may be recorded as
            // "this file has no references".
            Assert.Equal(DocumentManagerAPI.ReferenceReadStatus.Resolved, read.External.Status);
            Assert.Null(read.External.Detail);
            Assert.NotEqual("none", read.External.Method);
        }

        #endregion

        #region Per-view configurations, headlessly

        /// <summary>
        /// The two drawings whose referenced configuration was measured directly. The second is the
        /// case the metadata plan proved no filename heuristic can recover: the drawing is named for
        /// the dimension pair one way round and the configuration spells it the other.
        /// </summary>
        public static IEnumerable<object[]> MeasuredConfigurations => new[]
        {
            new object[] { "ORING-BUNA-70A-265.SLDDRW", "-265" },
            new object[] { "ORING-BUNA-70A-33X1.5.SLDDRW", "1.5X33-518" },
        };

        [DocumentManagerFixtureTheory(Oring)]
        [MemberData(nameof(MeasuredConfigurations))]
        public void A_drawing_view_names_the_configuration_it_shows(string drawingName, string expectedConfiguration)
        {
            var drawing = _fixtures.PathTo(Oring, drawingName);

            var read = _fixtures.Api.ReadReferences(drawing);

            Assert.NotNull(read.ViewReferences);
            var reference = Assert.Single(read.ViewReferences!);

            Assert.True(
                NameMatches(reference.Path, OringPart),
                $"{drawingName} should reference {OringPart}, but named {reference.FileName}");

            Assert.Equal(expectedConfiguration, reference.Configuration);
        }

        [DocumentManagerFixtureFact(Oring)]
        public void Every_drawing_in_the_fixture_resolves_a_model_and_a_configuration()
        {
            var unresolved = new List<string>();

            foreach (var drawing in _fixtures.FilesWithExtension(Oring, ".SLDDRW"))
            {
                var read = _fixtures.Api.ReadReferences(drawing);
                var name = Path.GetFileName(drawing);

                if (read.External.Status != DocumentManagerAPI.ReferenceReadStatus.Resolved)
                {
                    unresolved.Add($"{name}: read not answered ({read.External.Detail})");
                    continue;
                }

                if (read.ViewReferences == null || read.ViewReferences.Count == 0)
                {
                    unresolved.Add($"{name}: no view references");
                    continue;
                }

                var withoutConfiguration = read.ViewReferences
                    .Where(reference => string.IsNullOrEmpty(reference.Configuration))
                    .Select(reference => reference.FileName)
                    .ToList();

                if (withoutConfiguration.Count > 0)
                    unresolved.Add($"{name}: no configuration for {string.Join(", ", withoutConfiguration)}");
            }

            Assert.True(unresolved.Count == 0, string.Join(Environment.NewLine, unresolved));
        }

        [DocumentManagerFixtureFact(Oring)]
        public void The_referenced_configurations_are_not_all_the_same_template()
        {
            // Every drawing inheriting one configuration is the shape the old heuristic produced: it
            // fell through to configuration [0], which on this part is the XXX template. If that ever
            // comes back, this is what notices.
            var configurations = _fixtures
                .FilesWithExtension(Oring, ".SLDDRW")
                .Select(drawing => _fixtures.Api.ReadReferences(drawing))
                .Where(read => read.ViewReferences != null)
                .SelectMany(read => read.ViewReferences!)
                .Select(reference => reference.Configuration)
                .Where(configuration => !string.IsNullOrEmpty(configuration))
                .Distinct(StringComparer.Ordinal)
                .ToList();

            Assert.True(
                configurations.Count > 1,
                $"All the fixture's drawings report the same configuration: {string.Join(", ", configurations)}");

            Assert.DoesNotContain("XXX", configurations, StringComparer.OrdinalIgnoreCase);
        }

        [DocumentManagerFixtureFact(Oring)]
        public void A_view_reference_carries_a_full_path_and_not_the_bare_filename_the_interop_returns()
        {
            var drawing = _fixtures.PathTo(Oring, "ORING-BUNA-70A-265.SLDDRW");

            var reference = Assert.Single(_fixtures.Api.ReadReferences(drawing).ViewReferences!);

            // ISwDMView.ReferencedDocument returns "oring-buna-70a.sldprt" with no directory at all,
            // so a consumer that treats it as a path resolves it against its own working directory.
            Assert.True(
                Path.IsPathRooted(reference.Path),
                $"View reference resolved to '{reference.Path}', which is not a full path");
            Assert.True(
                File.Exists(reference.Path),
                $"View reference resolved to '{reference.Path}', which does not exist");
            Assert.Equal("Part", reference.FileType);
        }

        #endregion

        #region Filenames that differ only in case

        [DocumentManagerFixtureFact(Screw)]
        public void A_reference_resolves_when_the_drawing_and_the_part_differ_only_in_letter_case()
        {
            // The fixture is M4x0.7-...SLDDRW next to M4X0.7-...SLDPRT: same name, one letter's case
            // apart. Any matching that is not case-insensitive resolves this to nothing on Windows,
            // where the two names are the same file.
            var drawing = _fixtures.FilesWithExtension(Screw, ".SLDDRW").Single();
            var part = _fixtures.FilesWithExtension(Screw, ".SLDPRT").Single();

            Assert.NotEqual(
                Path.GetFileName(part),
                Path.GetFileName(drawing).Replace(".SLDDRW", ".SLDPRT"));

            var read = _fixtures.Api.ReadReferences(drawing);

            Assert.Equal(DocumentManagerAPI.ReferenceReadStatus.Resolved, read.External.Status);
            Assert.NotNull(read.ViewReferences);
            Assert.Contains(
                read.ViewReferences!,
                reference => NameMatches(reference.Path, Path.GetFileName(part)));
        }

        [DocumentManagerFixtureFact(Screw)]
        public void A_read_only_fixture_still_opens_for_reading()
        {
            // Every unchecked-out vault file is marked read-only, so this is the routine state, not
            // an edge case. A read that refuses it escalates into SolidWorks for no reason.
            var drawing = _fixtures.FilesWithExtension(Screw, ".SLDDRW").Single();
            Assert.True(new FileInfo(drawing).IsReadOnly, "The SCREW fixture is copied read-only on purpose");

            var read = _fixtures.Api.ReadReferences(drawing);

            Assert.Null(read.Failure?.Error);
            Assert.Equal(DocumentManagerAPI.ReferenceReadStatus.Resolved, read.External.Status);
        }

        #endregion

        #region A real assembly tree

        [DocumentManagerFixtureFact(NestedAssembly)]
        public void An_assembly_resolves_its_components()
        {
            var assembly = _fixtures.PathTo(NestedAssembly, "REGRESSION-TEST-T500X.SLDASM");

            var read = _fixtures.Api.ReadReferences(assembly);

            Assert.Equal(DocumentManagerAPI.ReferenceReadStatus.Resolved, read.External.Status);
            Assert.NotEmpty(read.External.References);

            // An assembly is not a drawing, so there are no views to read and no configurations.
            Assert.Null(read.ViewReferences);
        }

        [DocumentManagerFixtureFact(NestedAssembly)]
        public void Every_drawing_of_the_assembly_tree_resolves_a_model()
        {
            var unresolved = _fixtures
                .FilesWithExtension(NestedAssembly, ".SLDDRW")
                .Select(drawing => new
                {
                    Name = Path.GetFileName(drawing),
                    Read = _fixtures.Api.ReadReferences(drawing),
                })
                .Where(entry =>
                    entry.Read.External.Status != DocumentManagerAPI.ReferenceReadStatus.Resolved ||
                    entry.Read.ViewReferences == null ||
                    entry.Read.ViewReferences.Count == 0)
                .Select(entry => $"{entry.Name}: {entry.Read.External.Status}, {entry.Read.External.Detail}")
                .ToList();

            Assert.True(unresolved.Count == 0, string.Join(Environment.NewLine, unresolved));
        }

        #endregion

        #region Containment

        [DocumentManagerFixtureFact(Oring)]
        public void Reading_every_fixture_drawing_leaves_the_vault_byte_identical()
        {
            var watched = FixtureTripwire.DefaultWatchList();
            var before = FixtureTripwire.Capture(watched);

            foreach (var drawing in _fixtures.FilesWithExtension(Oring, ".SLDDRW"))
                _fixtures.Api.ReadReferences(drawing);

            _fixtures.Api.ReadReferences(_fixtures.PathTo(Oring, OringPart));

            var differences = FixtureTripwire.Capture(watched).DifferencesFrom(before);

            Assert.True(
                differences.Count == 0,
                "Reading references changed files in the vault:" + Environment.NewLine +
                string.Join(Environment.NewLine, differences));
        }

        [DocumentManagerFixtureFact(Oring)]
        public void The_code_under_test_is_never_handed_a_vault_path()
        {
            var sandbox = _fixtures.Sandbox(Oring);

            Assert.False(
                RegressionFixtureGuard.IsInside(sandbox.Root, RegressionFixtureGuard.DefaultFixtureRoot),
                $"The sandbox at {sandbox.Root} is inside the vault fixture root");

            Assert.True(RegressionFixtureGuard.IsInside(sandbox.SourcePath, RegressionFixtureGuard.DefaultFixtureRoot));

            foreach (var drawing in _fixtures.FilesWithExtension(Oring, ".SLDDRW"))
                Assert.StartsWith(sandbox.Root, drawing, StringComparison.OrdinalIgnoreCase);
        }

        #endregion

        private static bool NameMatches(string path, string fileName) =>
            string.Equals(Path.GetFileName(path), fileName, StringComparison.OrdinalIgnoreCase);
    }
}
