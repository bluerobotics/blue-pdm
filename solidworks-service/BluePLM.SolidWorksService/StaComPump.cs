using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// A long-lived STA thread with a Windows message pump, used to host the COM
    /// <see cref="IMessageFilter"/> and to run ROT lookups.
    /// </summary>
    /// <remarks>
    /// <para>
    /// CoRegisterMessageFilter only works on an STA thread, and the filter it installs
    /// applies to the apartment of the thread that registered it. The service's main
    /// thread is MTA on purpose - the DM API and the command loop are built around it,
    /// and marking Main as [STAThread] would change marshaling for every COM call in the
    /// process. A dedicated STA thread gets the filter without that blast radius.
    /// </para>
    /// <para>
    /// The pump matters because an STA that blocks on a plain wait handle cannot service
    /// incoming COM calls, which is the classic STA deadlock. Waiting via
    /// MsgWaitForMultipleObjectsEx and draining the queue keeps the apartment responsive
    /// while idle.
    /// </para>
    /// <para>
    /// Only work that is known to be short-running belongs here. A work item that hangs
    /// blocks the single thread for everyone, so <see cref="TryInvoke"/> marks the pump
    /// permanently unusable on timeout and callers must have a fallback.
    /// </para>
    /// </remarks>
    internal sealed class StaComPump : IDisposable
    {
        #region Native Interop

        private const uint QS_ALLINPUT = 0x04FF;
        private const uint MWMO_INPUTAVAILABLE = 0x0004;
        private const uint PM_REMOVE = 0x0001;
        private const uint WAIT_INFINITE = 0xFFFFFFFF;

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeMessage
        {
            public IntPtr Hwnd;
            public uint Message;
            public IntPtr WParam;
            public IntPtr LParam;
            public uint Time;
            public int PointX;
            public int PointY;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint MsgWaitForMultipleObjectsEx(
            uint nCount,
            IntPtr[] pHandles,
            uint dwMilliseconds,
            uint dwWakeMask,
            uint dwFlags);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool PeekMessage(
            out NativeMessage lpMsg,
            IntPtr hWnd,
            uint wMsgFilterMin,
            uint wMsgFilterMax,
            uint wRemoveMsg);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TranslateMessage([In] ref NativeMessage lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage([In] ref NativeMessage lpMsg);

        #endregion

        private sealed class WorkItem
        {
            public WorkItem(Action work)
            {
                Work = work;
            }

            public Action Work { get; }
            public ManualResetEventSlim Completed { get; } = new ManualResetEventSlim(false);
            public Exception? Error { get; set; }
        }

        private readonly MessageFilterRegistration _messageFilter;
        private readonly ConcurrentQueue<WorkItem> _queue = new ConcurrentQueue<WorkItem>();
        private readonly AutoResetEvent _workAvailable = new AutoResetEvent(false);
        private readonly ManualResetEventSlim _started = new ManualResetEventSlim(false);

        private Thread? _thread;
        private volatile bool _stopRequested;
        private volatile bool _faulted;
        private volatile bool _disposed;

        public StaComPump(MessageFilterRegistration messageFilter)
        {
            _messageFilter = messageFilter;
        }

        /// <summary>True while the thread is alive and no work item has ever hung on it.</summary>
        public bool IsUsable => _started.IsSet && !_faulted && !_stopRequested && !_disposed;

        /// <summary>
        /// Starts the thread and waits for it to reach the pump loop.
        /// </summary>
        /// <returns>True if the thread started within the timeout.</returns>
        public bool Start(int startTimeoutMs)
        {
            if (_thread != null) return _started.IsSet;

            _thread = new Thread(Run)
            {
                Name = "BluePLM STA COM pump",
                // The process must be able to exit even if a COM call never returns.
                IsBackground = true,
            };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();

            if (!_started.Wait(startTimeoutMs))
            {
                Console.Error.WriteLine($"[StaComPump] Thread did not start within {startTimeoutMs}ms");
                return false;
            }

            return true;
        }

        /// <summary>
        /// Runs an action on the STA thread and waits for it to finish.
        /// </summary>
        /// <param name="work">The action to run. Must be short-running.</param>
        /// <param name="timeoutMs">How long to wait before giving up on the pump.</param>
        /// <param name="error">The exception the action threw, if any.</param>
        /// <returns>
        /// False if the pump is unusable or the action did not finish in time, in which
        /// case the caller must fall back to its own thread. True means the action ran,
        /// whether or not it threw.
        /// </returns>
        public bool TryInvoke(Action work, int timeoutMs, out Exception? error)
        {
            error = null;
            if (!IsUsable) return false;

            var item = new WorkItem(work);
            _queue.Enqueue(item);
            _workAvailable.Set();

            if (!item.Completed.Wait(timeoutMs))
            {
                // The thread is stuck inside a COM call we cannot cancel. Everything queued
                // behind it would inherit the stall, so retire the pump.
                _faulted = true;
                Console.Error.WriteLine($"[StaComPump] Work item exceeded {timeoutMs}ms - pump retired");
                return false;
            }

            error = item.Error;
            return true;
        }

        private void Run()
        {
            bool filterRegistered = _messageFilter.Register();
            if (!filterRegistered)
            {
                Console.Error.WriteLine("[StaComPump] IMessageFilter registration failed on STA thread");
            }

            _started.Set();

            var handles = new[] { _workAvailable.SafeWaitHandle.DangerousGetHandle() };

            try
            {
                while (!_stopRequested)
                {
                    DrainQueue();
                    MsgWaitForMultipleObjectsEx(1, handles, WAIT_INFINITE, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
                    PumpMessages();
                }
            }
            catch (Exception ex)
            {
                _faulted = true;
                Console.Error.WriteLine($"[StaComPump] Pump loop failed: {ex.Message}");
            }
            finally
            {
                DrainQueue();
                _messageFilter.Unregister();
            }
        }

        private void DrainQueue()
        {
            while (_queue.TryDequeue(out var item))
            {
                try
                {
                    item.Work();
                }
                catch (Exception ex)
                {
                    item.Error = ex;
                }
                finally
                {
                    item.Completed.Set();
                }
            }
        }

        private static void PumpMessages()
        {
            while (PeekMessage(out var message, IntPtr.Zero, 0, 0, PM_REMOVE))
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            _stopRequested = true;
            _workAvailable.Set();

            // A short join only; the thread is background, so a stuck COM call cannot keep
            // the process alive.
            _thread?.Join(2000);
            _workAvailable.Dispose();
            _started.Dispose();
        }
    }
}
