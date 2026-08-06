using System;
using System.Collections.Generic;
using System.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Asserts that the managed mirrors in SwDmConstants match the installed Document Manager interop,
    /// and that the specific values this service passes across the COM boundary are members of the
    /// enums they are passed as.
    ///
    /// Two production constants were not members of their enum for years. The API rejected both and
    /// returned that rejection honestly; the caller discarded it. These tests are the detector that
    /// was missing.
    /// </summary>
    public class SwDmConstantsTests
    {
        #region Mirrors match the installed interop

        public static IEnumerable<object[]> MirroredEnums => new[]
        {
            new object[] { SwDmConstants.SearchFiltersEnumName, typeof(SwDmSearchFilter), "SwDmSearch" },
            new object[] { SwDmConstants.CustomInfoTypeEnumName, typeof(SwDmCustomInfoType), "swDmCustomInfo" },
            new object[] { SwDmConstants.DocumentOpenErrorEnumName, typeof(SwDmDocumentOpenError), "swDmDocumentOpenError" },
            new object[] { SwDmConstants.DocumentSaveErrorEnumName, typeof(SwDmDocumentSaveError), "swDmDocumentSaveError" },
        };

        [Theory]
        [MemberData(nameof(MirroredEnums))]
        public void Mirror_has_the_same_members_and_values_as_the_interop(
            string interopEnumName,
            Type mirrorType,
            string interopMemberPrefix)
        {
            if (!DocumentManagerInterop.IsAvailable) return;

            var interopMembers = DocumentManagerInterop.GetMembers(interopEnumName);

            var mirrorMembers = Enum.GetNames(mirrorType).ToDictionary(
                name => name,
                name => Convert.ToInt32(Enum.Parse(mirrorType, name)));

            // The mirror drops the vendor prefix, so compare on the unprefixed name.
            var normalisedInterop = interopMembers.ToDictionary(
                kvp => StripPrefix(kvp.Key, interopMemberPrefix),
                kvp => kvp.Value,
                StringComparer.OrdinalIgnoreCase);

            foreach (var member in mirrorMembers)
            {
                if (member.Key == "None" && !normalisedInterop.ContainsKey("None"))
                {
                    Assert.Equal(0, member.Value);
                    continue;
                }

                Assert.True(
                    normalisedInterop.ContainsKey(member.Key),
                    $"{mirrorType.Name}.{member.Key} has no counterpart in {interopEnumName}. " +
                    $"Interop members: {string.Join(", ", normalisedInterop.Keys)}");

                Assert.True(
                    normalisedInterop[member.Key] == member.Value,
                    $"{mirrorType.Name}.{member.Key} is {member.Value} but {interopEnumName} says " +
                    $"{normalisedInterop[member.Key]} (interop: {DocumentManagerInterop.LoadedFrom})");
            }
        }

        private static string StripPrefix(string name, string prefix) =>
            name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                ? name.Substring(prefix.Length)
                : name;

        #endregion

        #region The values production actually passes

        [Fact]
        public void Text_custom_property_type_is_a_defined_member()
        {
            Assert.True(
                Enum.IsDefined(typeof(SwDmCustomInfoType), SwDmConstants.CustomPropertyTextType),
                $"AddCustomProperty is passed {(int)SwDmConstants.CustomPropertyTextType}, which is not a " +
                $"member of SwDmCustomInfoType. Valid values: " +
                $"{string.Join(", ", Enum.GetValues(typeof(SwDmCustomInfoType)).Cast<SwDmCustomInfoType>().Select(v => $"{v}={(int)v}"))}. " +
                "AddCustomProperty returns false for an undefined type, so every property create fails.");
        }

        [Fact]
        public void Text_custom_property_type_is_Text()
        {
            Assert.Equal(SwDmCustomInfoType.Text, SwDmConstants.CustomPropertyTextType);
        }

        [Fact]
        public void Reference_resolution_searches_for_external_references()
        {
            Assert.True(
                SwDmConstants.ReferenceResolutionFilters.HasFlag(SwDmSearchFilter.ExternalReference),
                $"Reference resolution uses filters {(int)SwDmConstants.ReferenceResolutionFilters} " +
                $"({SwDmConstants.ReferenceResolutionFilters}), which does not set ExternalReference (16). " +
                "GetAllExternalReferences returns an empty array instead of the file's references.");
        }

        [Fact]
        public void Reference_resolution_matches_the_vendor_sample_combination()
        {
            var expected =
                SwDmSearchFilter.ExternalReference |
                SwDmSearchFilter.InContextReference |
                SwDmSearchFilter.RootAssemblyFolder |
                SwDmSearchFilter.Subfolders;

            Assert.Equal(SwDmConstants.ReferenceResolutionFilters, expected);
            Assert.Equal(113, (int)SwDmConstants.ReferenceResolutionFilters);
        }

        [Fact]
        public void Component_search_searches_for_external_references()
        {
            Assert.True(
                SwDmConstants.ComponentSearchFilters.HasFlag(SwDmSearchFilter.ExternalReference),
                $"Component search uses filters {(int)SwDmConstants.ComponentSearchFilters} " +
                $"({SwDmConstants.ComponentSearchFilters}), which does not set ExternalReference (16).");
        }

        #endregion

        #region Error decoding

        [Theory]
        [InlineData(SwDmDocumentOpenError.NonSW, "not a native SolidWorks file")]
        [InlineData(SwDmDocumentOpenError.FileNotFound, "not found")]
        [InlineData(SwDmDocumentOpenError.FileReadOnly, "read-only")]
        [InlineData(SwDmDocumentOpenError.NoLicense, "license")]
        [InlineData(SwDmDocumentOpenError.FutureVersion, "newer")]
        public void Open_error_description_matches_the_code_it_describes(SwDmDocumentOpenError error, string expectedFragment)
        {
            var description = DocumentManagerAPI.DescribeOpenError((int)error);

            Assert.True(
                description.IndexOf(expectedFragment, StringComparison.OrdinalIgnoreCase) >= 0,
                $"Open error {(int)error} is {error}, but it is described as \"{description}\", " +
                $"which does not mention \"{expectedFragment}\".");
        }

        #endregion
    }
}
