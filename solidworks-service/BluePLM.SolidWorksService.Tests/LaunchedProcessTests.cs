using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Telling a launch from an attach, which is the difference between owning a hidden
    /// SolidWorks BluePLM started and claiming the one the user is working in.
    ///
    /// The snapshot of running SLDWORKS.exe processes is taken immediately before CreateInstance
    /// for exactly this decision. It used to be gathered and then ignored on the path that
    /// normally answers: ISldWorks.GetProcessID was returned unexamined, and it reports whichever
    /// process the COM object lives in. Against a SolidWorks that came up in the moment between
    /// the "is one already running?" check and the call, that is the user's own session - which
    /// was then recorded as BluePLM's, hidden, and left eligible for the watchdog to close.
    /// </summary>
    public class LaunchedProcessTests
    {
        [Fact]
        public void A_reported_pid_that_was_not_running_beforehand_is_a_launch()
        {
            var launched = LaunchedProcessResolver.Resolve(23456, new int[0], new[] { 23456 });

            Assert.Equal(LaunchOutcome.Launched, launched.Outcome);
            Assert.Equal(23456, launched.ProcessId);
            Assert.True(launched.IsOurs);
        }

        [Fact]
        public void A_reported_pid_that_was_already_running_is_an_attach_and_is_never_claimed()
        {
            // The user's SolidWorks, started before BluePLM asked for one.
            var launched = LaunchedProcessResolver.Resolve(4242, new[] { 4242 }, new[] { 4242 });

            Assert.Equal(LaunchOutcome.AttachedToExisting, launched.Outcome);
            Assert.Equal(0, launched.ProcessId);
            Assert.False(launched.IsOurs);
            Assert.Contains("already running", launched.Reason);
        }

        [Fact]
        public void An_attach_is_recognised_even_when_another_solidworks_starts_alongside_it()
        {
            // A second instance appearing during the call must not launder the reported PID:
            // the question is only whether the PID that was reported is new.
            var launched = LaunchedProcessResolver.Resolve(4242, new[] { 4242 }, new[] { 4242, 5555 });

            Assert.Equal(LaunchOutcome.AttachedToExisting, launched.Outcome);
            Assert.Equal(0, launched.ProcessId);
        }

        [Fact]
        public void A_pid_solidworks_will_not_report_falls_back_to_the_process_that_appeared()
        {
            var launched = LaunchedProcessResolver.Resolve(0, new[] { 100, 200 }, new[] { 100, 200, 300 });

            Assert.Equal(LaunchOutcome.Launched, launched.Outcome);
            Assert.Equal(300, launched.ProcessId);
        }

        [Fact]
        public void Nothing_new_appearing_means_the_handle_was_an_existing_session()
        {
            var launched = LaunchedProcessResolver.Resolve(0, new[] { 100 }, new[] { 100 });

            Assert.Equal(LaunchOutcome.AttachedToExisting, launched.Outcome);
            Assert.Equal(0, launched.ProcessId);
            Assert.False(launched.IsOurs);
        }

        [Fact]
        public void Two_new_processes_leave_the_launch_unidentified_rather_than_guessed()
        {
            var launched = LaunchedProcessResolver.Resolve(0, new[] { 100 }, new[] { 100, 300, 400 });

            Assert.Equal(LaunchOutcome.Unidentified, launched.Outcome);
            Assert.Equal(0, launched.ProcessId);

            // The COM handle is still ours to close even though no PID can be named for it.
            Assert.True(launched.IsOurs);
        }

        [Fact]
        public void A_process_enumeration_that_answered_nothing_leaves_the_launch_unidentified()
        {
            // GetSolidWorksProcessIds returns an empty array when the enumeration throws, which is
            // not evidence that nothing is running.
            var launched = LaunchedProcessResolver.Resolve(0, new[] { 100 }, new int[0]);

            Assert.Equal(LaunchOutcome.Unidentified, launched.Outcome);
            Assert.Equal(0, launched.ProcessId);
        }

        [Fact]
        public void A_duplicated_pid_in_the_snapshot_does_not_look_like_two_launches()
        {
            var launched = LaunchedProcessResolver.Resolve(0, new int[0], new[] { 300, 300 });

            Assert.Equal(LaunchOutcome.Launched, launched.Outcome);
            Assert.Equal(300, launched.ProcessId);
        }

        [Fact]
        public void A_snapshot_that_could_not_be_taken_is_not_proof_that_nothing_was_running()
        {
            // Null is the enumeration failing, which is not the same fact as an empty machine.
            // Treating the two alike would let a reported PID pass as new on any machine where
            // Process.GetProcessesByName threw.
            var launched = LaunchedProcessResolver.Resolve(23456, null, new[] { 23456 });

            Assert.Equal(LaunchOutcome.Unidentified, launched.Outcome);
            Assert.Equal(0, launched.ProcessId);
            Assert.Contains("could not be read", launched.Reason);
        }

        [Fact]
        public void An_empty_snapshot_from_a_machine_with_no_solidworks_still_proves_a_launch()
        {
            var launched = LaunchedProcessResolver.Resolve(23456, new int[0], new[] { 23456 });

            Assert.Equal(LaunchOutcome.Launched, launched.Outcome);
            Assert.Equal(23456, launched.ProcessId);
        }
    }
}
