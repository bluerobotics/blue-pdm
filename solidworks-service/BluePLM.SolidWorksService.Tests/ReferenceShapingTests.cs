using System;
using System.Collections.Generic;
using System.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The parts of the reference read that do not need SolidWorks, Document Manager or a fixture:
    /// decoding the broken-reference out-parameter, pairing it with the returned paths, and turning
    /// a view's bare filename back into a path.
    ///
    /// These run everywhere, including on a machine with no SolidWorks at all.
    /// </summary>
    public class ReferenceShapingTests
    {
        #region The broken-reference out-parameter

        [Fact]
        public void A_null_out_parameter_marks_nothing_broken()
        {
            Assert.Empty(DocumentManagerAPI.ReadBrokenFlags(null, referenceCount: 3));
        }

        [Fact]
        public void An_array_of_flags_is_read_positionally()
        {
            var flags = DocumentManagerAPI.ReadBrokenFlags(new object[] { false, true, false }, referenceCount: 3);

            Assert.Equal(new[] { false, true, false }, flags);
        }

        [Fact]
        public void Flags_are_truncated_to_the_number_of_references_returned()
        {
            var flags = DocumentManagerAPI.ReadBrokenFlags(new object[] { true, true, true }, referenceCount: 1);

            Assert.Single(flags);
        }

        [Fact]
        public void A_variant_that_is_not_an_array_of_flags_marks_nothing_broken()
        {
            // Reading a shape we did not expect must not invent breakage; the references themselves
            // are still good, and reporting them all broken would be worse than reporting none.
            Assert.Empty(DocumentManagerAPI.ReadBrokenFlags("not an array", referenceCount: 2));
            Assert.Empty(DocumentManagerAPI.ReadBrokenFlags(new object?[] { null, null }, referenceCount: 2)
                .Where(flag => flag));
        }

        [Fact]
        public void A_single_flag_applies_to_a_single_reference()
        {
            Assert.Equal(new[] { true }, DocumentManagerAPI.ReadBrokenFlags(true, referenceCount: 1));
            Assert.Empty(DocumentManagerAPI.ReadBrokenFlags(true, referenceCount: 2));
        }

        #endregion

        #region Pairing paths with their status

        [Fact]
        public void Each_reference_carries_its_own_broken_status()
        {
            var references = DocumentManagerAPI.BuildReferenceList(
                new[] { @"C:\v\a.SLDPRT", @"C:\v\b.SLDPRT" },
                new[] { false, true });

            Assert.Equal(2, references.Count);
            Assert.False(references[0].IsBroken);
            Assert.True(references[1].IsBroken);
        }

        [Fact]
        public void A_reference_with_no_flag_is_not_reported_as_broken()
        {
            var references = DocumentManagerAPI.BuildReferenceList(
                new[] { @"C:\v\a.SLDPRT", @"C:\v\b.SLDPRT" },
                Array.Empty<bool>());

            Assert.All(references, reference => Assert.False(reference.IsBroken));
        }

        [Fact]
        public void Blank_and_duplicate_paths_are_dropped()
        {
            var references = DocumentManagerAPI.BuildReferenceList(
                new[] { @"C:\v\a.SLDPRT", string.Empty, @"c:\V\A.sldprt", @"C:\v\b.SLDPRT" },
                Array.Empty<bool>());

            Assert.Equal(2, references.Count);
        }

        [Fact]
        public void Dropping_a_duplicate_does_not_shift_the_remaining_flags_onto_the_wrong_path()
        {
            // The flags are positional against the array the API returned, so they have to be read
            // before anything is filtered out.
            var references = DocumentManagerAPI.BuildReferenceList(
                new[] { @"C:\v\a.SLDPRT", @"C:\v\a.SLDPRT", @"C:\v\b.SLDPRT" },
                new[] { false, false, true });

            Assert.Equal(2, references.Count);
            Assert.True(references.Single(r => r.Path.EndsWith("b.SLDPRT", StringComparison.Ordinal)).IsBroken);
        }

        #endregion

        #region Turning a view's bare filename back into a path

        [Fact]
        public void A_bare_filename_resolves_against_the_reference_list()
        {
            var resolved = DocumentManagerAPI.ResolveReferencedDocumentPath(
                "oring-buna-70a.sldprt",
                @"C:\vault\parts\ORING-BUNA-70A-265.SLDDRW",
                new[] { @"C:\vault\models\ORING-BUNA-70A.SLDPRT" });

            // The reference list went through the configured search paths, so it knows where the file
            // really is - which is not necessarily beside the drawing.
            Assert.Equal(@"C:\vault\models\ORING-BUNA-70A.SLDPRT", resolved);
        }

        [Fact]
        public void Resolution_ignores_letter_case()
        {
            var resolved = DocumentManagerAPI.ResolveReferencedDocumentPath(
                "m4x0.7-20-ss316-socket-head-cap-screw.sldprt",
                @"C:\vault\M4x0.7-20-SS316-SOCKET-HEAD-CAP-SCREW.SLDDRW",
                new[] { @"C:\vault\M4X0.7-20-SS316-SOCKET-HEAD-CAP-SCREW.SLDPRT" });

            Assert.Equal(@"C:\vault\M4X0.7-20-SS316-SOCKET-HEAD-CAP-SCREW.SLDPRT", resolved);
        }

        [Fact]
        public void A_bare_filename_with_no_match_falls_back_to_the_drawings_own_folder()
        {
            var resolved = DocumentManagerAPI.ResolveReferencedDocumentPath(
                "oring-buna-70a.sldprt",
                @"C:\vault\parts\ORING-BUNA-70A-265.SLDDRW",
                Array.Empty<string>());

            Assert.Equal(@"C:\vault\parts\oring-buna-70a.sldprt", resolved);
        }

        [Fact]
        public void A_full_path_is_left_alone()
        {
            const string absolute = @"C:\elsewhere\ORING-BUNA-70A.SLDPRT";

            Assert.Equal(
                absolute,
                DocumentManagerAPI.ResolveReferencedDocumentPath(absolute, @"C:\vault\d.SLDDRW", Array.Empty<string>()));
        }

        [Fact]
        public void A_candidate_with_the_same_name_in_a_different_folder_wins_over_the_drawings_folder()
        {
            var resolved = DocumentManagerAPI.ResolveReferencedDocumentPath(
                "part.sldprt",
                @"C:\vault\drawings\d.SLDDRW",
                new[] { @"C:\vault\drawings\other.SLDPRT", @"C:\vault\models\PART.SLDPRT" });

            Assert.Equal(@"C:\vault\models\PART.SLDPRT", resolved);
        }

        #endregion

        #region The wire shape consumers switch on

        [Theory]
        [InlineData(@"C:\v\a.SLDPRT", "Part")]
        [InlineData(@"C:\v\a.sldprt", "Part")]
        [InlineData(@"C:\v\a.SLDASM", "Assembly")]
        [InlineData(@"C:\v\a.SLDDRW", "Drawing")]
        [InlineData(@"C:\v\a.step", "Other")]
        public void The_file_type_label_matches_what_the_SolidWorks_traversal_emits(string path, string expected)
        {
            Assert.Equal(expected, DocumentManagerAPI.ClassifyFileType(path));
        }

        #endregion

        #region The unresolved outcome

        [Fact]
        public void An_unavailable_read_carries_no_references_and_says_why()
        {
            var read = DocumentManagerAPI.ExternalReferenceRead.Unavailable("the interop declares nothing");

            Assert.False(read.IsResolved);
            Assert.Empty(read.References);
            Assert.Equal("the interop declares nothing", read.Detail);
        }

        [Fact]
        public void A_resolved_read_with_no_references_is_still_resolved()
        {
            var read = DocumentManagerAPI.ExternalReferenceRead.Resolved(
                Array.Empty<DocumentManagerAPI.ExternalReference>(),
                "GetAllExternalReferences4/ISwDMDocument21");

            Assert.True(read.IsResolved);
            Assert.Empty(read.References);
            Assert.Null(read.Detail);
        }

        [Fact]
        public void The_unresolved_wire_code_is_the_one_the_app_matches_on()
        {
            // The renderer compares against this string exactly, so renaming the constant alone is
            // not enough.
            Assert.Equal("REFERENCES_UNRESOLVED", DocumentManagerAPI.ReferencesUnresolvedCode);
        }

        #endregion

        #region Grouping views by the model they show

        [Fact]
        public void A_model_shown_by_several_views_keeps_every_distinct_configuration()
        {
            var reference = new DocumentManagerAPI.DrawingViewReference(
                @"C:\v\ORING-BUNA-70A.SLDPRT",
                new List<string> { "-265", "-277" });

            Assert.Equal("-265", reference.Configuration);
            Assert.Equal(new[] { "-265", "-277" }, reference.Configurations);
            Assert.Equal("ORING-BUNA-70A.SLDPRT", reference.FileName);
            Assert.Equal("Part", reference.FileType);
        }

        [Fact]
        public void A_model_no_view_names_a_configuration_for_reports_none_rather_than_an_empty_string()
        {
            var reference = new DocumentManagerAPI.DrawingViewReference(
                @"C:\v\PART.SLDPRT",
                Array.Empty<string>());

            Assert.Null(reference.Configuration);
            Assert.Empty(reference.Configurations);
        }

        #endregion
    }
}
