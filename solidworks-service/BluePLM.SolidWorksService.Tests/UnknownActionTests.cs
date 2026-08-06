using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The answer the dispatch gives for an action this build does not implement.
    ///
    /// This matters because the app can be newer than the service running on a machine. When it is,
    /// every call to a command added since that service was built fails, and without a code naming
    /// the cause the failures look like the files. A vault-wide read is the worst case: thousands of
    /// identical failures, each of them plausible.
    /// </summary>
    public class UnknownActionTests
    {
        [Fact]
        public void The_unknown_action_wire_code_is_the_one_the_app_matches_on()
        {
            // The renderer compares against this string exactly, so renaming the constant alone is
            // not enough.
            Assert.Equal("UNKNOWN_ACTION", Program.UnknownActionCode);
        }

        [Fact]
        public void An_action_this_build_lacks_is_named_rather_than_reported_as_a_bare_failure()
        {
            var result = Program.UnknownAction("getPropertiesDocumentManager");

            Assert.False(result.Success);
            Assert.Equal(Program.UnknownActionCode, result.ErrorCode);
            Assert.Contains("getPropertiesDocumentManager", result.Error);
        }
    }
}
