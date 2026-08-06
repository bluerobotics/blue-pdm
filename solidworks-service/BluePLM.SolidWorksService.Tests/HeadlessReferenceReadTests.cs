using System.Reflection;

using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// The reference read a background request is allowed to make, held to the one property that
    /// matters: it cannot put a document on the user's screen.
    ///
    /// This is the incident that started all of it. A watcher batch made documents appear in the
    /// user's SolidWorks, and the fix put an origin gate in front of the tier that calls OpenDoc6.
    /// The gate was real but it was not first: the step before it reused the handle SolidWorks
    /// already had for a document, and the reader it called to do that was the same one the gated
    /// tier used - which opens the document, and launches SolidWorks to open it, whenever the
    /// handle is not there. The only thing standing in the way was an "is it open?" check taken a
    /// moment earlier, so what remained was a narrower race rather than a closed door.
    ///
    /// Asserting this by calling the method would need SolidWorks, a document, and the race to
    /// land. The property is about reachability, so it is asserted against reachability.
    /// </summary>
    public class HeadlessReferenceReadTests
    {
        /// <summary>Everything that opens a document, or can end up launching SolidWorks to.</summary>
        public static readonly object[][] ForbiddenOnABackgroundPath =
        {
            new object[] { "OpenDoc6" },
            new object[] { "OpenDocument" },
            new object[] { "GetSolidWorks" },
        };

        private static MethodInfo Method(string name) =>
            typeof(SolidWorksAPI).GetMethod(name, BindingFlags.Public | BindingFlags.Instance)!;

        [Fact]
        public void The_background_reader_exists_and_is_the_one_the_service_can_call()
        {
            var reader = Method("GetExternalReferencesFromOpenDocument");

            Assert.NotNull(reader);
            Assert.Equal(typeof(CommandResult), reader.ReturnType);
        }

        [Theory]
        [MemberData(nameof(ForbiddenOnABackgroundPath))]
        public void The_background_reader_cannot_reach_anything_that_opens_a_document(string forbidden)
        {
            var reader = Method("GetExternalReferencesFromOpenDocument");

            Assert.False(
                MethodReachability.Reaches(reader, forbidden),
                MethodReachability.Describe(reader, forbidden));
        }

        [Fact]
        public void The_background_reader_still_reads_references_rather_than_declining_everything()
        {
            // A method that reached nothing would pass the assertions above trivially. It has to
            // find the running instance, ask it for the document, and shape the same answer the
            // foreground reader shapes.
            var reader = Method("GetExternalReferencesFromOpenDocument");

            Assert.True(MethodReachability.Reaches(reader, "GetRunningSwInstanceOrNull"));
            Assert.True(MethodReachability.Reaches(reader, "GetOpenDocument"));
            Assert.True(MethodReachability.Reaches(reader, "ReadExternalReferences"));
        }

        [Theory]
        [MemberData(nameof(ForbiddenOnABackgroundPath))]
        public void The_foreground_reader_is_the_one_that_may_open_a_document(string reached)
        {
            // The counterpart: the assertions above would also pass if nothing anywhere opened a
            // document, which would mean the reachability walk was measuring nothing.
            var reader = Method("GetExternalReferences");

            Assert.True(
                MethodReachability.Reaches(reader, reached),
                $"GetExternalReferences should be able to reach {reached}; if it cannot, this walk sees nothing.");
        }

        [Fact]
        public void The_service_actually_wires_the_background_reader_in()
        {
            // The reader existing and being incapable of opening a document is worth nothing if
            // GetReferencesFast never calls it.
            var dispatch = typeof(SolidWorksAPI).Assembly
                .GetType("BluePLM.SolidWorksService.Program")!
                .GetMethod("GetReferencesFast", BindingFlags.NonPublic | BindingFlags.Static)!;

            Assert.NotNull(dispatch);
            Assert.True(
                MethodReachability.Reaches(dispatch, "GetExternalReferencesFromOpenDocument"),
                "GetReferencesFast never reaches the reader that cannot open a document.");
        }

        [Fact]
        public void The_shared_shaping_step_opens_nothing_of_its_own()
        {
            // Both readers hand a live document to the same shaping code, so that code is on the
            // background path too and must be as incapable of opening anything as the reader is.
            var shape = typeof(SolidWorksAPI).GetMethod(
                "ReadExternalReferences",
                BindingFlags.NonPublic | BindingFlags.Instance)!;

            Assert.NotNull(shape);

            foreach (var forbidden in new[] { "OpenDoc6", "OpenDocument", "GetSolidWorks" })
                Assert.False(MethodReachability.Reaches(shape, forbidden), MethodReachability.Describe(shape, forbidden));
        }
    }
}
