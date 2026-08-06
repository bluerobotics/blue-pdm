using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

using Newtonsoft.Json.Linq;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Clearing a metadata field has to leave the custom property in the document with an empty
    /// value. It used to remove the property, on all four write paths.
    ///
    /// The reason is outside BluePLM. A drawing title block linked with <c>$PRP:"Description"</c>
    /// renders blank against a property that exists and is empty; against one that is not there it
    /// can break, and what it breaks into is the literal text <c>$PRP:"Description"</c> on a
    /// released print. "The user cleared this" and "this was never set" are also different facts,
    /// and the service could not report the difference because the write removed the property and
    /// the read then dropped empty values anyway.
    ///
    /// These write to %TEMP% copies of the fixtures - <see cref="FixtureSandbox"/> hands the code
    /// under test the copy and never the vault path - and every read-back goes through a Document
    /// Manager application that did not perform the write.
    /// </summary>
    public class EmptyPropertyWriteTests : IClassFixture<DocumentManagerFixtures>, IDisposable
    {
        private const string Oring = FixtureSandbox.OringFixture;
        private const string OringPart = "ORING-BUNA-70A.SLDPRT";
        private const string OringDrawing = "ORING-BUNA-70A-265.SLDDRW";

        /// <summary>Prefix that keeps these out of the way of the fixture's real properties.</summary>
        private const string TestPropertyPrefix = "BluePLM_Test_";

        private readonly DocumentManagerFixtures _fixtures;

        /// <summary>
        /// Reads back through an application that did not perform the write, so a value cached on
        /// the writing handle cannot pass for one that reached the file.
        /// </summary>
        private DocumentManagerAPI? _reader;

        public EmptyPropertyWriteTests(DocumentManagerFixtures fixtures) => _fixtures = fixtures;

        #region The decision, end to end

        [DocumentManagerFixtureFact(Oring)]
        public void A_cleared_file_level_property_stays_in_the_document_as_an_empty_one()
        {
            var part = WritableCopyOf(OringPart);
            var name = PropertyName("FileClear");

            AssertWritten(_fixtures.Api.SetCustomProperties(part, new Dictionary<string, string> { [name] = "before" }));
            Assert.Equal("before", ReadFileProperty(part, name));

            AssertWritten(_fixtures.Api.SetCustomProperties(part, new Dictionary<string, string> { [name] = "" }));

            var after = ReadFileProperties(part);
            Assert.True(after.ContainsKey(name), $"'{name}' was removed from the document instead of emptied.");
            Assert.Equal(string.Empty, after[name]);
        }

        [DocumentManagerFixtureFact(Oring)]
        public void A_cleared_configuration_property_stays_in_the_configuration_as_an_empty_one()
        {
            var part = WritableCopyOf(OringPart);
            var configuration = FirstConfiguration(part);
            var name = PropertyName("ConfigClear");

            AssertWritten(_fixtures.Api.SetCustomProperties(part, new Dictionary<string, string> { [name] = "before" }, configuration));
            Assert.Equal("before", ReadConfigurationProperty(part, configuration, name));

            AssertWritten(_fixtures.Api.SetCustomProperties(part, new Dictionary<string, string> { [name] = "" }, configuration));

            var after = ReadConfigurationProperties(part, configuration);
            Assert.True(after.ContainsKey(name), $"'{name}' was removed from '{configuration}' instead of emptied.");
            Assert.Equal(string.Empty, after[name]);
        }

        [DocumentManagerFixtureFact(Oring)]
        public void A_batch_write_clears_a_configuration_property_without_removing_it()
        {
            var part = WritableCopyOf(OringPart);
            var configuration = FirstConfiguration(part);
            var name = PropertyName("BatchClear");

            AssertWritten(_fixtures.Api.SetCustomPropertiesBatch(part, Batch(configuration, name, "before")));
            Assert.Equal("before", ReadConfigurationProperty(part, configuration, name));

            AssertWritten(_fixtures.Api.SetCustomPropertiesBatch(part, Batch(configuration, name, "")));

            var after = ReadConfigurationProperties(part, configuration);
            Assert.True(after.ContainsKey(name), $"'{name}' was removed from '{configuration}' instead of emptied.");
            Assert.Equal(string.Empty, after[name]);
        }

        [DocumentManagerFixtureFact(Oring)]
        public void A_cleared_property_on_a_drawing_stays_in_the_drawing()
        {
            // The document type the whole decision is about: a title block reads this scope.
            var drawing = WritableCopyOf(OringDrawing);
            var name = PropertyName("DrawingClear");

            AssertWritten(_fixtures.Api.SetCustomProperties(drawing, new Dictionary<string, string> { [name] = "before" }));
            AssertWritten(_fixtures.Api.SetCustomProperties(drawing, new Dictionary<string, string> { [name] = "" }));

            var after = ReadFileProperties(drawing);
            Assert.True(after.ContainsKey(name), $"'{name}' was removed from the drawing instead of emptied.");
            Assert.Equal(string.Empty, after[name]);
        }

        #endregion

        #region Reading the difference

        [DocumentManagerFixtureFact(Oring)]
        public void A_property_that_is_empty_and_one_that_was_never_written_read_differently()
        {
            // The read used to drop empty values, which made these two the same answer and left the
            // app unable to verify a clear as anything more specific than "not the old value".
            var part = WritableCopyOf(OringPart);
            var emptied = PropertyName("Emptied");
            var never = PropertyName("NeverWritten");

            AssertWritten(_fixtures.Api.SetCustomProperties(part, new Dictionary<string, string> { [emptied] = "" }));

            var properties = ReadFileProperties(part);

            Assert.True(properties.ContainsKey(emptied));
            Assert.Equal(string.Empty, properties[emptied]);
            Assert.False(properties.ContainsKey(never));
        }

        #endregion

        #region Delete, now that it has to be asked for

        [DocumentManagerFixtureFact(Oring)]
        public void DeleteProperties_takes_the_property_out_of_the_document()
        {
            var part = WritableCopyOf(OringPart);
            var name = PropertyName("Deleted");

            AssertWritten(_fixtures.Api.SetCustomProperties(part, new Dictionary<string, string> { [name] = "doomed" }));
            Assert.True(ReadFileProperties(part).ContainsKey(name));

            var deleted = _fixtures.Api.DeleteCustomProperties(part, new List<string> { name });

            Assert.True(deleted.Success, deleted.Error);
            Assert.Equal(1, DataValue<int>(deleted, "propertiesDeleted"));
            Assert.False(ReadFileProperties(part).ContainsKey(name));
        }

        [DocumentManagerFixtureFact(Oring)]
        public void Deleting_a_property_that_is_not_there_is_a_no_op_rather_than_a_failure()
        {
            var part = WritableCopyOf(OringPart);

            var deleted = _fixtures.Api.DeleteCustomProperties(part, new List<string> { PropertyName("Absent") });

            Assert.True(deleted.Success, deleted.Error);
            Assert.Equal(0, DataValue<int>(deleted, "propertiesDeleted"));
            Assert.Equal(1, DataValue<int>(deleted, "propertiesNotPresent"));
            Assert.Equal(0, DataValue<int>(deleted, "propertiesFailed"));
        }

        [DocumentManagerFixtureFact(Oring)]
        public void A_configuration_property_can_be_deleted_from_its_own_configuration()
        {
            var part = WritableCopyOf(OringPart);
            var configuration = FirstConfiguration(part);
            var name = PropertyName("ConfigDeleted");

            AssertWritten(_fixtures.Api.SetCustomProperties(part, new Dictionary<string, string> { [name] = "doomed" }, configuration));
            Assert.True(ReadConfigurationProperties(part, configuration).ContainsKey(name));

            var deleted = _fixtures.Api.DeleteCustomProperties(part, new List<string> { name }, configuration);

            Assert.True(deleted.Success, deleted.Error);
            Assert.False(ReadConfigurationProperties(part, configuration).ContainsKey(name));
        }

        #endregion

        #region Helpers

        /// <summary>
        /// A sandbox copy with the read-only attribute cleared. The fixtures are read-only in the
        /// vault, File.Copy carries that across, and Document Manager refuses a read-only file with
        /// swDmDocumentOpenErrorFileReadOnly - which is the vault's own behaviour and correct, so
        /// checking the copy out is the test's job rather than the service's.
        /// </summary>
        private string WritableCopyOf(string relativePath)
        {
            var path = _fixtures.PathTo(Oring, relativePath);
            FixtureFile.ClearReadOnly(path);
            return path;
        }

        private static Dictionary<string, Dictionary<string, string>> Batch(string configuration, string name, string value) =>
            new Dictionary<string, Dictionary<string, string>>
            {
                [configuration] = new Dictionary<string, string> { [name] = value },
            };

        /// <summary>Unique per run, so a value left by an earlier run cannot make a test pass.</summary>
        private static string PropertyName(string purpose) =>
            $"{TestPropertyPrefix}{purpose}_{Guid.NewGuid():N}".Substring(0, 40);

        private static void AssertWritten(CommandResult result) => Assert.True(result.Success, result.Error);

        private DocumentManagerAPI Reader
        {
            get
            {
                if (_reader != null) return _reader;

                var reader = new DocumentManagerAPI(DocumentManagerLicense.Key);
                Assert.True(reader.Initialize(), reader.InitializationError);
                _reader = reader;
                return _reader;
            }
        }

        private string FirstConfiguration(string filePath)
        {
            var read = Reader.GetCustomProperties(filePath);
            Assert.True(read.Success, read.Error);

            var configurations = JObject.FromObject(read.Data!)["configurations"]?.ToObject<List<string>>();
            Assert.True(configurations != null && configurations.Count > 0, $"{filePath} reports no configurations");
            return configurations![0];
        }

        /// <summary>
        /// The property bag as the app receives it, read from the serialised payload rather than
        /// from the objects behind it: whether the app can tell an empty property from an absent one
        /// is a question about what crosses the wire.
        /// </summary>
        private Dictionary<string, string> ReadFileProperties(string filePath)
        {
            var read = Reader.GetCustomProperties(filePath);
            Assert.True(read.Success, read.Error);

            return JObject.FromObject(read.Data!)["fileProperties"]?.ToObject<Dictionary<string, string>>()
                ?? new Dictionary<string, string>();
        }

        private string? ReadFileProperty(string filePath, string name) =>
            ReadFileProperties(filePath).TryGetValue(name, out var value) ? value : null;

        private Dictionary<string, string> ReadConfigurationProperties(string filePath, string configuration)
        {
            var read = Reader.GetCustomProperties(filePath, configuration);
            Assert.True(read.Success, read.Error);

            var bags = JObject.FromObject(read.Data!)["configurationProperties"]
                ?.ToObject<Dictionary<string, Dictionary<string, string>>>();

            return bags != null && bags.TryGetValue(configuration, out var properties)
                ? properties
                : new Dictionary<string, string>();
        }

        private string? ReadConfigurationProperty(string filePath, string configuration, string name) =>
            ReadConfigurationProperties(filePath, configuration).TryGetValue(name, out var value) ? value : null;

        private static T DataValue<T>(CommandResult result, string field) =>
            JObject.FromObject(result.Data!)[field]!.ToObject<T>()!;

        public void Dispose()
        {
            _reader?.Dispose();
            _reader = null;
        }

        #endregion
    }

    /// <summary>
    /// The same guarantee asked of the code rather than of a document: no property write can reach
    /// a delete any more, and the command that is supposed to delete still can.
    ///
    /// Worth asserting separately because the round-trip tests above skip on a machine with no
    /// Document Manager licence, and because a future edit could reintroduce the empty-means-delete
    /// branch without any fixture noticing until someone cleared a field on a released drawing.
    /// </summary>
    public class PropertyWritePathTests
    {
        private static MethodInfo Method(Type type, string name) =>
            type.GetMethod(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)!;

        [Fact]
        public void The_SolidWorks_write_path_cannot_reach_Delete2()
        {
            var write = Method(typeof(SolidWorksAPI), "WriteCustomProperties");

            Assert.False(
                MethodReachability.Reaches(write, "Delete2"),
                MethodReachability.Describe(write, "Delete2"));
        }

        [Fact]
        public void The_SolidWorks_write_path_still_writes()
        {
            // A method that reached nothing would pass the assertion above for the wrong reason.
            var write = Method(typeof(SolidWorksAPI), "WriteCustomProperties");

            Assert.True(MethodReachability.Reaches(write, "Set2"));
            Assert.True(MethodReachability.Reaches(write, "Add3"));
        }

        [Fact]
        public void The_SolidWorks_delete_command_is_the_only_thing_left_that_reaches_Delete2()
        {
            var delete = Method(typeof(SolidWorksAPI), "DeleteCustomProperties");

            Assert.True(
                MethodReachability.Reaches(delete, "Delete2"),
                "Deleting a property has to remain expressible; deleteProperties is how a caller asks.");
        }

        [Theory]
        [InlineData("SetCustomProperties")]
        [InlineData("SetCustomPropertiesBatch")]
        public void A_Document_Manager_write_cannot_reach_the_delete_helper(string writeMethod)
        {
            var write = Method(typeof(DocumentManagerAPI), writeMethod);

            Assert.True(
                MethodReachability.Reaches(write, "WriteProperty"),
                $"{writeMethod} should write every property through the shared helper.");
            Assert.False(
                MethodReachability.Reaches(write, "DeleteProperty"),
                MethodReachability.Describe(write, "DeleteProperty"));
        }

        [Fact]
        public void The_Document_Manager_delete_command_reaches_the_delete_helper()
        {
            var delete = Method(typeof(DocumentManagerAPI), "DeleteCustomProperties");

            Assert.True(MethodReachability.Reaches(delete, "DeleteProperty"));
        }
    }

    /// <summary>
    /// Which Number a batch leaves at file level. The file-level copy exists so a reader that does
    /// not look at configurations still finds the number, and it used to be skipped entirely when
    /// the value was empty - which left the old number sitting in the file after the user cleared it.
    /// </summary>
    public class NumberMirrorTests
    {
        private static Dictionary<string, Dictionary<string, string>> Configs(
            params (string Configuration, string? Number)[] entries)
        {
            var result = new Dictionary<string, Dictionary<string, string>>();
            foreach (var entry in entries)
            {
                result[entry.Configuration] = entry.Number == null
                    ? new Dictionary<string, string> { ["Description"] = "something else" }
                    : new Dictionary<string, string> { ["Number"] = entry.Number };
            }
            return result;
        }

        [Fact]
        public void A_batch_that_never_mentions_Number_leaves_the_file_level_one_alone()
        {
            var (requested, _) = DocumentManagerAPI.ResolveNumberToMirror(Configs(("Default", null)));

            Assert.False(requested);
        }

        [Fact]
        public void A_cleared_Number_is_mirrored_as_empty_rather_than_skipped()
        {
            var (requested, value) = DocumentManagerAPI.ResolveNumberToMirror(Configs(("Default", "")));

            Assert.True(requested, "Leaving the file-level Number behind is how a cleared number comes back.");
            Assert.Equal(string.Empty, value);
        }

        [Fact]
        public void A_number_that_some_configuration_still_carries_survives_another_clearing_it()
        {
            // Order matters here only because it used to: "last one wins" would blank the file-level
            // copy for a document that still has the number on one of its configurations.
            var (requested, value) = DocumentManagerAPI.ResolveNumberToMirror(
                Configs(("A", "PN-1000"), ("B", "")));

            Assert.True(requested);
            Assert.Equal("PN-1000", value);
        }

        [Fact]
        public void The_last_configuration_to_name_a_number_is_the_one_mirrored()
        {
            var (_, value) = DocumentManagerAPI.ResolveNumberToMirror(
                Configs(("A", "PN-1000"), ("B", "PN-2000")));

            Assert.Equal("PN-2000", value);
        }
    }
}
