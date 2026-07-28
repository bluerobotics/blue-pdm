using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace BluePLM.SolidWorksService
{
    #region COM Error Codes

    /// <summary>
    /// Enumeration of COM operation result codes for structured error reporting.
    /// Maps to TypeScript SwErrorCode enum on the Electron side for consistent error handling.
    /// </summary>
    public enum ComErrorCode
    {
        /// <summary>
        /// Operation completed successfully.
        /// </summary>
        Success = 0,

        /// <summary>
        /// Operation timed out waiting for SolidWorks to respond.
        /// May indicate a very long rebuild or file loading operation.
        /// </summary>
        Timeout = 1,

        /// <summary>
        /// RPC (Remote Procedure Call) failed due to COM communication error.
        /// Typically caused by SolidWorks being busy with another operation.
        /// </summary>
        RpcFailed = 2,

        /// <summary>
        /// SolidWorks is temporarily busy processing another request.
        /// The operation should be retried automatically after a short delay.
        /// </summary>
        SwBusy = 3,

        /// <summary>
        /// SolidWorks is not running and could not be started.
        /// User may need to manually launch SolidWorks.
        /// </summary>
        SwNotRunning = 4,

        /// <summary>
        /// SolidWorks is running but not responding to API calls.
        /// May be stuck in a modal dialog or crash recovery state.
        /// </summary>
        SwUnresponsive = 5,

        /// <summary>
        /// The requested file is not currently open in SolidWorks.
        /// Required for operations that need an already-open document.
        /// </summary>
        FileNotOpen = 6,

        /// <summary>
        /// An unknown or unexpected error occurred.
        /// Check ErrorDetails for more information.
        /// </summary>
        Unknown = 99
    }

    #endregion

    #region Health Status

    /// <summary>
    /// Enumeration of SolidWorks health check results.
    /// Used to determine if SolidWorks is ready for API operations.
    /// </summary>
    public enum SwHealthStatus
    {
        /// <summary>
        /// SolidWorks is running and responding normally to API calls.
        /// </summary>
        Healthy,

        /// <summary>
        /// SolidWorks is running but temporarily busy with another operation.
        /// Operations may succeed if retried after a short delay.
        /// </summary>
        Busy,

        /// <summary>
        /// SolidWorks is running but not responding to health check probes.
        /// May be stuck in a modal dialog or experiencing issues.
        /// </summary>
        Unresponsive,

        /// <summary>
        /// SolidWorks is not running on this machine.
        /// </summary>
        NotRunning
    }

    #endregion

    #region COM Operation Result

    /// <summary>
    /// Represents the result of a COM operation with error code and optional data.
    /// Provides structured error information for upstream error handling.
    /// </summary>
    /// <typeparam name="T">The type of the result data.</typeparam>
    public class ComOperationResult<T>
    {
        /// <summary>
        /// Gets or sets the result error code.
        /// </summary>
        public ComErrorCode ErrorCode { get; set; } = ComErrorCode.Success;

        /// <summary>
        /// Gets or sets the operation result data (when successful).
        /// </summary>
        public T? Data { get; set; }

        /// <summary>
        /// Gets or sets the error message (when failed).
        /// </summary>
        public string? ErrorMessage { get; set; }

        /// <summary>
        /// Gets or sets detailed exception information for diagnostics.
        /// </summary>
        public string? ErrorDetails { get; set; }

        /// <summary>
        /// Gets whether the operation was successful.
        /// </summary>
        public bool IsSuccess => ErrorCode == ComErrorCode.Success;

        /// <summary>
        /// Creates a successful result with data.
        /// </summary>
        /// <param name="data">The result data.</param>
        /// <returns>A successful ComOperationResult.</returns>
        public static ComOperationResult<T> Success(T data) => new ComOperationResult<T>
        {
            ErrorCode = ComErrorCode.Success,
            Data = data
        };

        /// <summary>
        /// Creates a failed result with error information.
        /// </summary>
        /// <param name="errorCode">The error code.</param>
        /// <param name="message">The error message.</param>
        /// <param name="details">Optional detailed error information.</param>
        /// <returns>A failed ComOperationResult.</returns>
        public static ComOperationResult<T> Failure(ComErrorCode errorCode, string message, string? details = null) => new ComOperationResult<T>
        {
            ErrorCode = errorCode,
            ErrorMessage = message,
            ErrorDetails = details
        };
    }

    #endregion

    #region IMessageFilter Implementation

    /// <summary>
    /// COM IMessageFilter interface for handling incoming and outgoing COM calls.
    /// Required for proper handling of busy server responses in STA threads.
    /// </summary>
    /// <remarks>
    /// When SolidWorks is busy (loading files, rebuilding models, etc.), COM calls
    /// return SERVERCALL_RETRYLATER. Without IMessageFilter, these cause RPC_E_CALL_REJECTED
    /// exceptions. With IMessageFilter registered, we can tell COM to wait and retry.
    /// </remarks>
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("00000016-0000-0000-C000-000000000046")]
    internal interface IMessageFilter
    {
        /// <summary>
        /// Handles incoming calls to this process.
        /// </summary>
        /// <param name="dwCallType">Type of incoming call.</param>
        /// <param name="hTaskCaller">Handle of calling task.</param>
        /// <param name="dwTickCount">Elapsed tick count.</param>
        /// <param name="lpInterfaceInfo">Pointer to INTERFACEINFO structure.</param>
        /// <returns>SERVERCALL constant indicating how to handle the call.</returns>
        [PreserveSig]
        int HandleInComingCall(
            int dwCallType,
            IntPtr hTaskCaller,
            int dwTickCount,
            IntPtr lpInterfaceInfo);

        /// <summary>
        /// Called when an outgoing call is rejected by the server.
        /// </summary>
        /// <param name="hTaskCallee">Handle of called task.</param>
        /// <param name="dwTickCount">Elapsed tick count.</param>
        /// <param name="dwRejectType">Type of rejection.</param>
        /// <returns>Milliseconds to wait before retrying, or -1 to cancel.</returns>
        [PreserveSig]
        int RetryRejectedCall(
            IntPtr hTaskCallee,
            int dwTickCount,
            int dwRejectType);

        /// <summary>
        /// Called when a message arrives while waiting for an outgoing call.
        /// </summary>
        /// <param name="hTaskCallee">Handle of called task.</param>
        /// <param name="dwTickCount">Elapsed tick count.</param>
        /// <param name="dwPendingType">Type of pending call.</param>
        /// <returns>PENDINGMSG constant indicating how to handle the message.</returns>
        [PreserveSig]
        int MessagePending(
            IntPtr hTaskCallee,
            int dwTickCount,
            int dwPendingType);
    }

    /// <summary>
    /// Implementation of IMessageFilter that handles busy server responses.
    /// Provides automatic retry with configurable delays for rejected COM calls.
    /// </summary>
    /// <remarks>
    /// This filter is designed for SolidWorks automation where the server frequently
    /// enters busy states during file operations, model rebuilds, and drawing updates.
    /// The filter implements progressive retry delays to avoid hammering the server
    /// while still providing responsive recovery when the server becomes available.
    /// </remarks>
    internal class ComMessageFilter : IMessageFilter
    {
        // SERVERCALL constants
        private const int SERVERCALL_ISHANDLED = 0;
        private const int SERVERCALL_REJECTED = 1;
        private const int SERVERCALL_RETRYLATER = 2;

        // PENDINGMSG constants
        private const int PENDINGMSG_CANCELCALL = 0;
        private const int PENDINGMSG_WAITNOPROCESS = 1;
        private const int PENDINGMSG_WAITDEFPROCESS = 2;

        // Retry timing configuration (milliseconds)
        private const int MIN_RETRY_DELAY_MS = 100;
        private const int MAX_RETRY_DELAY_MS = 500;
        private const int RETRY_DELAY_INCREMENT_MS = 50;

        // Maximum wait time before giving up (30 seconds)
        private const int MAX_WAIT_TIME_MS = 30000;

        private int _consecutiveRetries;
        private readonly object _lock = new object();

        /// <summary>
        /// Gets the total number of retries performed during this filter's lifetime.
        /// </summary>
        public int TotalRetryCount { get; private set; }

        /// <summary>
        /// Handles incoming calls. Always returns SERVERCALL_ISHANDLED to accept calls.
        /// </summary>
        public int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo)
        {
            // Accept all incoming calls - we're not a server, just a client
            return SERVERCALL_ISHANDLED;
        }

        /// <summary>
        /// Called when our outgoing call is rejected by the server (SolidWorks).
        /// Returns the number of milliseconds to wait before retrying.
        /// </summary>
        public int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType)
        {
            lock (_lock)
            {
                // Check if we've waited too long
                if (dwTickCount > MAX_WAIT_TIME_MS)
                {
                    Console.Error.WriteLine($"[ComStability] RetryRejectedCall: Max wait time exceeded ({dwTickCount}ms), cancelling call");
                    _consecutiveRetries = 0;
                    return -1; // Cancel the call
                }

                if (dwRejectType == SERVERCALL_RETRYLATER)
                {
                    _consecutiveRetries++;
                    TotalRetryCount++;

                    // Calculate delay with progressive backoff
                    int delay = Math.Min(
                        MIN_RETRY_DELAY_MS + (_consecutiveRetries * RETRY_DELAY_INCREMENT_MS),
                        MAX_RETRY_DELAY_MS);

                    // Log every 5th retry to avoid log spam
                    if (_consecutiveRetries == 1 || _consecutiveRetries % 5 == 0)
                    {
                        Console.Error.WriteLine($"[ComStability] RetryRejectedCall: Server busy (retry #{_consecutiveRetries}, total waited: {dwTickCount}ms, next delay: {delay}ms)");
                    }

                    return delay;
                }

                // For SERVERCALL_REJECTED (server truly rejected, not busy), cancel
                if (dwRejectType == SERVERCALL_REJECTED)
                {
                    Console.Error.WriteLine($"[ComStability] RetryRejectedCall: Server rejected call (dwRejectType={dwRejectType}), cancelling");
                    _consecutiveRetries = 0;
                    return -1;
                }

                // Unknown reject type, try a short retry
                Console.Error.WriteLine($"[ComStability] RetryRejectedCall: Unknown reject type {dwRejectType}, retrying in {MIN_RETRY_DELAY_MS}ms");
                return MIN_RETRY_DELAY_MS;
            }
        }

        /// <summary>
        /// Called when Windows messages arrive while waiting for an outgoing call.
        /// Returns PENDINGMSG_WAITDEFPROCESS to process messages normally.
        /// </summary>
        public int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType)
        {
            // Process Windows messages normally while waiting
            // This prevents the UI from freezing during long waits
            return PENDINGMSG_WAITDEFPROCESS;
        }

        /// <summary>
        /// Resets the consecutive retry counter. Call after a successful operation.
        /// </summary>
        public void ResetRetryCount()
        {
            lock (_lock)
            {
                _consecutiveRetries = 0;
            }
        }
    }

    #endregion

    #region Message Filter Registration

    /// <summary>
    /// Helper class for registering and unregistering the COM message filter.
    /// Implements IDisposable for automatic cleanup.
    /// </summary>
    internal class MessageFilterRegistration : IDisposable
    {
        [DllImport("ole32.dll")]
        private static extern int CoRegisterMessageFilter(IMessageFilter? newFilter, out IMessageFilter? oldFilter);

        private IMessageFilter? _oldFilter;
        private ComMessageFilter? _currentFilter;
        private bool _isRegistered;
        private bool _disposed;
        private readonly object _lock = new object();

        /// <summary>
        /// Gets the current message filter instance.
        /// </summary>
        public ComMessageFilter? CurrentFilter => _currentFilter;

        /// <summary>
        /// Gets whether the message filter is currently registered.
        /// </summary>
        public bool IsRegistered
        {
            get
            {
                lock (_lock)
                {
                    return _isRegistered;
                }
            }
        }

        /// <summary>
        /// Registers the COM message filter on the current thread.
        /// Must be called from an STA thread.
        /// </summary>
        /// <returns>True if registration was successful.</returns>
        public bool Register()
        {
            lock (_lock)
            {
                if (_isRegistered)
                {
                    Console.Error.WriteLine("[ComStability] MessageFilter already registered");
                    return true;
                }

                try
                {
                    _currentFilter = new ComMessageFilter();
                    int hr = CoRegisterMessageFilter(_currentFilter, out _oldFilter);

                    if (hr != 0)
                    {
                        Console.Error.WriteLine($"[ComStability] CoRegisterMessageFilter failed with HRESULT: 0x{hr:X8}");
                        _currentFilter = null;
                        return false;
                    }

                    _isRegistered = true;
                    Console.Error.WriteLine("[ComStability] IMessageFilter registered successfully");
                    return true;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[ComStability] Failed to register IMessageFilter: {ex.Message}");
                    _currentFilter = null;
                    return false;
                }
            }
        }

        /// <summary>
        /// Unregisters the COM message filter and restores the previous filter.
        /// </summary>
        public void Unregister()
        {
            lock (_lock)
            {
                if (!_isRegistered)
                    return;

                try
                {
                    CoRegisterMessageFilter(_oldFilter, out _);
                    _isRegistered = false;
                    Console.Error.WriteLine($"[ComStability] IMessageFilter unregistered (total retries handled: {_currentFilter?.TotalRetryCount ?? 0})");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[ComStability] Error unregistering IMessageFilter: {ex.Message}");
                }
                finally
                {
                    _currentFilter = null;
                    _oldFilter = null;
                }
            }
        }

        /// <summary>
        /// Disposes the message filter registration.
        /// </summary>
        public void Dispose()
        {
            if (_disposed)
                return;

            Unregister();
            _disposed = true;
        }
    }

    #endregion

    #region COM Stability Layer

    /// <summary>
    /// Enterprise-level COM stability layer for SolidWorks automation.
    /// Provides IMessageFilter integration, automatic retry with exponential backoff,
    /// health checking, and serialized COM call execution.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This class addresses the "remote procedure call failed" errors that occur when
    /// SolidWorks is busy processing (loading files, rebuilding models, updating drawings).
    /// It implements three layers of protection:
    /// </para>
    /// <list type="number">
    ///   <item>
    ///     <term>IMessageFilter</term>
    ///     <description>Handles SERVERCALL_RETRYLATER at the COM level</description>
    ///   </item>
    ///   <item>
    ///     <term>ExecuteWithRetry</term>
    ///     <description>Catches and retries RPC exceptions with exponential backoff</description>
    ///   </item>
    ///   <item>
    ///     <term>ComCallSerializer</term>
    ///     <description>Ensures only one COM call executes at a time</description>
    ///   </item>
    /// </list>
    /// <para>
    /// Usage:
    /// </para>
    /// <code>
    /// using var stability = new ComStabilityLayer();
    /// stability.Initialize();
    /// 
    /// var result = stability.ExecuteWithRetry(() => {
    ///     var sw = Marshal.GetActiveObject("SldWorks.Application");
    ///     return ((ISldWorks)sw).RevisionNumber();
    /// });
    /// </code>
    /// </remarks>
    public class ComStabilityLayer : IDisposable
    {
        #region Constants

        // Retryable HRESULT error codes from COM/RPC
        private const int RPC_E_CALL_REJECTED = unchecked((int)0x80010001);
        private const int RPC_E_SERVERCALL_RETRYLATER = unchecked((int)0x8001010A);
        private const int RPC_E_SERVERFAULT = unchecked((int)0x80010105);
        private const int RPC_S_CALL_FAILED = unchecked((int)0x800706BE);
        private const int RPC_E_DISCONNECTED = unchecked((int)0x80010108);
        private const int CO_E_OBJNOTCONNECTED = unchecked((int)0x800401FD);

        // Retry configuration
        private const int DEFAULT_MAX_RETRIES = 3;
        private const int BASE_RETRY_DELAY_MS = 100;
        private const int MAX_RETRY_DELAY_MS = 2000;

        // Health check configuration
        private const int HEALTH_CHECK_TIMEOUT_MS = 2000;

        // How long to wait for the STA pump thread to reach its message loop
        private const int STA_PUMP_START_TIMEOUT_MS = 5000;

        #endregion

        #region Fields

        private readonly MessageFilterRegistration _messageFilter;
        private readonly SemaphoreSlim _comCallSerializer;
        private readonly StaComPump _staPump;
        private bool _initialized;
        private bool _disposed;
        private readonly object _initLock = new object();

        #endregion

        #region Constructor

        /// <summary>
        /// Initializes a new instance of the ComStabilityLayer.
        /// Call <see cref="Initialize"/> before using COM operations.
        /// </summary>
        public ComStabilityLayer()
        {
            _messageFilter = new MessageFilterRegistration();
            _comCallSerializer = new SemaphoreSlim(1, 1);
            _staPump = new StaComPump(_messageFilter);

            Console.Error.WriteLine("[ComStability] ComStabilityLayer instance created");
        }

        #endregion

        #region Initialization

        /// <summary>
        /// Initializes the COM stability layer by starting the STA pump thread, which in
        /// turn registers the IMessageFilter on its own apartment.
        /// </summary>
        /// <remarks>
        /// CoRegisterMessageFilter is rejected on MTA threads, and the service's main
        /// thread is deliberately MTA. Registering on a dedicated STA thread gets busy
        /// handling for the calls routed through <see cref="TryInvokeOnSta{T}"/> without
        /// changing the apartment - and therefore the marshaling - of the whole process.
        /// </remarks>
        /// <returns>True if initialization was successful.</returns>
        /// <exception cref="ObjectDisposedException">Thrown if the layer has been disposed.</exception>
        public bool Initialize()
        {
            ThrowIfDisposed();

            lock (_initLock)
            {
                if (_initialized)
                {
                    Console.Error.WriteLine("[ComStability] Already initialized");
                    return true;
                }

                Console.Error.WriteLine("[ComStability] Initializing COM stability layer...");

                bool pumpStarted = _staPump.Start(STA_PUMP_START_TIMEOUT_MS);
                if (!pumpStarted)
                {
                    Console.Error.WriteLine("[ComStability] WARNING: STA pump thread failed to start");
                }
                else if (!_messageFilter.IsRegistered)
                {
                    Console.Error.WriteLine("[ComStability] WARNING: IMessageFilter registration failed");
                    Console.Error.WriteLine("[ComStability] COM busy states will cause RPC_E_CALL_REJECTED exceptions");
                }

                _initialized = true;
                Console.Error.WriteLine("[ComStability] Initialization complete");
                return true;
            }
        }

        /// <summary>
        /// Runs a short COM operation on the STA thread that owns the IMessageFilter.
        /// </summary>
        /// <typeparam name="T">The return type of the operation.</typeparam>
        /// <param name="operation">The operation. Must be short-running - the pump is shared.</param>
        /// <param name="timeoutMs">How long to wait before giving up on the pump.</param>
        /// <param name="result">The operation's return value when it ran without throwing.</param>
        /// <returns>
        /// False if the pump was unavailable or the operation did not finish in time; the
        /// caller must then fall back to its own thread. True means the operation ran, in
        /// which case <paramref name="result"/> is default if it threw.
        /// </returns>
        public bool TryInvokeOnSta<T>(Func<T> operation, int timeoutMs, out T? result)
        {
            ThrowIfDisposed();

            if (operation == null)
                throw new ArgumentNullException(nameof(operation));

            T? captured = default;
            bool ran = _staPump.TryInvoke(() => captured = operation(), timeoutMs, out var error);

            if (!ran)
            {
                result = default;
                return false;
            }

            if (error != null)
            {
                Console.Error.WriteLine($"[ComStability] STA operation threw: {error.Message}");
                result = default;
                return true;
            }

            result = captured;
            return true;
        }

        /// <summary>
        /// Gets whether the stability layer is initialized.
        /// </summary>
        public bool IsInitialized
        {
            get
            {
                lock (_initLock)
                {
                    return _initialized;
                }
            }
        }

        /// <summary>
        /// Gets whether the IMessageFilter is currently registered.
        /// </summary>
        public bool IsMessageFilterRegistered => _messageFilter.IsRegistered;

        #endregion

        #region Health Check

        /// <summary>
        /// Performs a health check on SolidWorks to determine its readiness for API operations.
        /// Uses a lightweight API call with timeout to probe responsiveness.
        /// </summary>
        /// <param name="timeoutMs">Timeout in milliseconds for the health check probe.</param>
        /// <returns>The current health status of SolidWorks.</returns>
        /// <remarks>
        /// This method should be called before critical operations (like SaveDocument or 
        /// SetDocumentReadOnly) to verify SolidWorks is ready. If the status is not Healthy,
        /// the caller should wait or inform the user.
        /// </remarks>
        public SwHealthStatus HealthCheck(int timeoutMs = HEALTH_CHECK_TIMEOUT_MS)
        {
            ThrowIfDisposed();

            Console.Error.WriteLine($"[ComStability] Performing health check (timeout: {timeoutMs}ms)...");

            try
            {
                // Try to get the active SolidWorks instance
                object? swObj = null;
                try
                {
                    swObj = Marshal.GetActiveObject("SldWorks.Application");
                }
                catch (COMException ex) when (ex.HResult == unchecked((int)0x800401E3)) // MK_E_UNAVAILABLE
                {
                    Console.Error.WriteLine("[ComStability] Health check: SolidWorks not running");
                    return SwHealthStatus.NotRunning;
                }

                if (swObj == null)
                {
                    Console.Error.WriteLine("[ComStability] Health check: GetActiveObject returned null");
                    return SwHealthStatus.NotRunning;
                }

                // Use a task with timeout to probe SolidWorks responsiveness
                bool probeCompleted = false;
                string? revisionNumber = null;
                Exception? probeException = null;

                var probeThread = new Thread(() =>
                {
                    try
                    {
                        // Try a lightweight API call
                        dynamic swApp = swObj;
                        revisionNumber = swApp.RevisionNumber();
                        probeCompleted = true;
                    }
                    catch (Exception ex)
                    {
                        probeException = ex;
                    }
                });

                probeThread.SetApartmentState(ApartmentState.STA);
                probeThread.Start();

                bool threadCompleted = probeThread.Join(timeoutMs);

                if (!threadCompleted)
                {
                    Console.Error.WriteLine("[ComStability] Health check: Probe timed out - SolidWorks unresponsive");
                    return SwHealthStatus.Unresponsive;
                }

                if (probeException != null)
                {
                    if (IsRetryableException(probeException))
                    {
                        Console.Error.WriteLine($"[ComStability] Health check: SolidWorks busy ({probeException.Message})");
                        return SwHealthStatus.Busy;
                    }

                    Console.Error.WriteLine($"[ComStability] Health check: Probe failed ({probeException.Message})");
                    return SwHealthStatus.Unresponsive;
                }

                if (probeCompleted)
                {
                    Console.Error.WriteLine($"[ComStability] Health check: Healthy (SW revision: {revisionNumber})");
                    return SwHealthStatus.Healthy;
                }

                Console.Error.WriteLine("[ComStability] Health check: Unknown state");
                return SwHealthStatus.Unresponsive;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[ComStability] Health check failed: {ex.Message}");
                return SwHealthStatus.Unresponsive;
            }
        }

        /// <summary>
        /// Asynchronously performs a health check with cancellation support.
        /// </summary>
        /// <param name="timeoutMs">Timeout in milliseconds.</param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The health status.</returns>
        public async Task<SwHealthStatus> HealthCheckAsync(int timeoutMs = HEALTH_CHECK_TIMEOUT_MS, CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();

            // Run on thread pool to avoid blocking the caller
            return await Task.Run(() => HealthCheck(timeoutMs), cancellationToken);
        }

        #endregion

        #region Execute With Retry

        /// <summary>
        /// Executes a COM operation with automatic retry on transient failures.
        /// Uses exponential backoff to avoid overwhelming a busy SolidWorks instance.
        /// </summary>
        /// <typeparam name="T">The return type of the operation.</typeparam>
        /// <param name="operation">The COM operation to execute.</param>
        /// <param name="maxRetries">Maximum number of retry attempts.</param>
        /// <param name="operationName">Name of the operation for logging.</param>
        /// <returns>A ComOperationResult containing the result or error information.</returns>
        /// <remarks>
        /// <para>
        /// This method catches COMException with these HRESULTs as retryable:
        /// </para>
        /// <list type="bullet">
        ///   <item>0x80010001 (RPC_E_CALL_REJECTED) - Server busy</item>
        ///   <item>0x8001010A (RPC_E_SERVERCALL_RETRYLATER) - Retry later</item>
        ///   <item>0x80010105 (RPC_E_SERVERFAULT) - Server fault</item>
        ///   <item>0x800706BE (RPC_S_CALL_FAILED) - RPC call failed</item>
        /// </list>
        /// <para>
        /// The delay between retries follows exponential backoff:
        /// 100ms, 200ms, 400ms, 800ms, ... up to MAX_RETRY_DELAY_MS (2000ms).
        /// </para>
        /// </remarks>
        public ComOperationResult<T> ExecuteWithRetry<T>(
            Func<T> operation,
            int maxRetries = DEFAULT_MAX_RETRIES,
            string operationName = "COM operation")
        {
            ThrowIfDisposed();

            if (operation == null)
                throw new ArgumentNullException(nameof(operation));

            int attempt = 0;
            int delayMs = BASE_RETRY_DELAY_MS;
            Exception? lastException = null;

            while (attempt <= maxRetries)
            {
                try
                {
                    if (attempt > 0)
                    {
                        Console.Error.WriteLine($"[ComStability] {operationName}: Attempt {attempt + 1}/{maxRetries + 1}");
                    }

                    T result = operation();

                    // Reset message filter retry count on success
                    _messageFilter.CurrentFilter?.ResetRetryCount();

                    if (attempt > 0)
                    {
                        Console.Error.WriteLine($"[ComStability] {operationName}: Succeeded on attempt {attempt + 1}");
                    }

                    return ComOperationResult<T>.Success(result);
                }
                catch (COMException comEx)
                {
                    lastException = comEx;

                    if (IsRetryableHResult(comEx.HResult) && attempt < maxRetries)
                    {
                        var errorCode = ClassifyComError(comEx.HResult);
                        Console.Error.WriteLine($"[ComStability] {operationName}: {GetHResultName(comEx.HResult)} (0x{comEx.HResult:X8}), retrying in {delayMs}ms...");

                        Thread.Sleep(delayMs);

                        // Exponential backoff
                        delayMs = Math.Min(delayMs * 2, MAX_RETRY_DELAY_MS);
                        attempt++;
                        continue;
                    }

                    // Not retryable or max retries exceeded
                    Console.Error.WriteLine($"[ComStability] {operationName}: Failed with HRESULT 0x{comEx.HResult:X8} after {attempt + 1} attempt(s)");

                    return ComOperationResult<T>.Failure(
                        ClassifyComError(comEx.HResult),
                        GetUserFriendlyMessage(comEx.HResult),
                        comEx.ToString());
                }
                catch (Exception ex)
                {
                    lastException = ex;
                    Console.Error.WriteLine($"[ComStability] {operationName}: Unexpected exception: {ex.Message}");

                    return ComOperationResult<T>.Failure(
                        ComErrorCode.Unknown,
                        $"Unexpected error: {ex.Message}",
                        ex.ToString());
                }
            }

            // Should not reach here, but handle just in case
            Console.Error.WriteLine($"[ComStability] {operationName}: Max retries ({maxRetries}) exceeded");

            return ComOperationResult<T>.Failure(
                lastException is COMException comEx2 ? ClassifyComError(comEx2.HResult) : ComErrorCode.Unknown,
                $"Operation failed after {maxRetries} retries",
                lastException?.ToString());
        }

        /// <summary>
        /// Executes a COM operation with automatic retry (void return type).
        /// </summary>
        /// <param name="operation">The COM operation to execute.</param>
        /// <param name="maxRetries">Maximum number of retry attempts.</param>
        /// <param name="operationName">Name of the operation for logging.</param>
        /// <returns>A ComOperationResult indicating success or failure.</returns>
        public ComOperationResult<bool> ExecuteWithRetry(
            Action operation,
            int maxRetries = DEFAULT_MAX_RETRIES,
            string operationName = "COM operation")
        {
            return ExecuteWithRetry(() =>
            {
                operation();
                return true;
            }, maxRetries, operationName);
        }

        #endregion

        #region Serialized Execution

        /// <summary>
        /// Executes a COM operation with serialization to ensure only one operation runs at a time.
        /// This prevents race conditions when multiple operations are queued.
        /// </summary>
        /// <typeparam name="T">The return type of the operation.</typeparam>
        /// <param name="operation">The COM operation to execute.</param>
        /// <param name="timeoutMs">Maximum time to wait for the serializer lock.</param>
        /// <param name="operationName">Name of the operation for logging.</param>
        /// <param name="quiet">If true, suppresses verbose logging for high-frequency polling operations.</param>
        /// <returns>A ComOperationResult containing the result or error information.</returns>
        /// <remarks>
        /// <para>
        /// COM calls to SolidWorks should generally be serialized because:
        /// </para>
        /// <list type="bullet">
        ///   <item>SolidWorks COM interface is not fully thread-safe</item>
        ///   <item>Concurrent operations can cause unpredictable behavior</item>
        ///   <item>The IMessageFilter retry mechanism works best with serialized calls</item>
        /// </list>
        /// <para>
        /// Document Manager operations do NOT need serialization as they use a separate API.
        /// Use <see cref="ExecuteWithRetry{T}"/> directly for Document Manager calls.
        /// </para>
        /// </remarks>
        public ComOperationResult<T> ExecuteSerialized<T>(
            Func<T> operation,
            int timeoutMs = 30000,
            string operationName = "Serialized COM operation",
            bool quiet = false)
        {
            ThrowIfDisposed();

            if (operation == null)
                throw new ArgumentNullException(nameof(operation));

            if (!quiet)
                Console.Error.WriteLine($"[ComStability] {operationName}: Waiting for serializer lock...");

            bool lockAcquired = false;
            try
            {
                lockAcquired = _comCallSerializer.Wait(timeoutMs);

                if (!lockAcquired)
                {
                    Console.Error.WriteLine($"[ComStability] {operationName}: Timeout waiting for serializer lock ({timeoutMs}ms)");
                    return ComOperationResult<T>.Failure(
                        ComErrorCode.Timeout,
                        "Operation timed out waiting for previous operation to complete");
                }

                if (!quiet)
                    Console.Error.WriteLine($"[ComStability] {operationName}: Lock acquired, executing...");

                // Execute with retry inside the serializer
                return ExecuteWithRetry(operation, DEFAULT_MAX_RETRIES, operationName);
            }
            finally
            {
                if (lockAcquired)
                {
                    _comCallSerializer.Release();
                    if (!quiet)
                        Console.Error.WriteLine($"[ComStability] {operationName}: Lock released");
                }
            }
        }

        /// <summary>
        /// Executes a COM operation with serialization (void return type).
        /// </summary>
        /// <param name="operation">The COM operation to execute.</param>
        /// <param name="timeoutMs">Maximum time to wait for the serializer lock.</param>
        /// <param name="operationName">Name of the operation for logging.</param>
        /// <param name="quiet">If true, suppresses verbose logging for high-frequency polling operations.</param>
        /// <returns>A ComOperationResult indicating success or failure.</returns>
        public ComOperationResult<bool> ExecuteSerialized(
            Action operation,
            int timeoutMs = 30000,
            string operationName = "Serialized COM operation",
            bool quiet = false)
        {
            return ExecuteSerialized(() =>
            {
                operation();
                return true;
            }, timeoutMs, operationName, quiet);
        }

        /// <summary>
        /// Asynchronously executes a serialized COM operation.
        /// </summary>
        /// <typeparam name="T">The return type of the operation.</typeparam>
        /// <param name="operation">The COM operation to execute.</param>
        /// <param name="timeoutMs">Maximum time to wait for the serializer lock.</param>
        /// <param name="operationName">Name of the operation for logging.</param>
        /// <param name="quiet">If true, suppresses verbose logging for high-frequency polling operations.</param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>A ComOperationResult containing the result or error information.</returns>
        public async Task<ComOperationResult<T>> ExecuteSerializedAsync<T>(
            Func<T> operation,
            int timeoutMs = 30000,
            string operationName = "Async serialized COM operation",
            bool quiet = false,
            CancellationToken cancellationToken = default)
        {
            ThrowIfDisposed();

            if (operation == null)
                throw new ArgumentNullException(nameof(operation));

            if (!quiet)
                Console.Error.WriteLine($"[ComStability] {operationName}: Waiting for serializer lock (async)...");

            bool lockAcquired = false;
            try
            {
                lockAcquired = await _comCallSerializer.WaitAsync(timeoutMs, cancellationToken);

                if (!lockAcquired)
                {
                    Console.Error.WriteLine($"[ComStability] {operationName}: Timeout waiting for serializer lock ({timeoutMs}ms)");
                    return ComOperationResult<T>.Failure(
                        ComErrorCode.Timeout,
                        "Operation timed out waiting for previous operation to complete");
                }

                if (!quiet)
                    Console.Error.WriteLine($"[ComStability] {operationName}: Lock acquired, executing...");

                // Execute with retry (synchronous, but holding the lock)
                return ExecuteWithRetry(operation, DEFAULT_MAX_RETRIES, operationName);
            }
            finally
            {
                if (lockAcquired)
                {
                    _comCallSerializer.Release();
                    if (!quiet)
                        Console.Error.WriteLine($"[ComStability] {operationName}: Lock released");
                }
            }
        }

        #endregion

        #region Error Classification

        /// <summary>
        /// Determines if an HRESULT indicates a retryable error.
        /// </summary>
        /// <param name="hResult">The HRESULT error code.</param>
        /// <returns>True if the error is retryable.</returns>
        public static bool IsRetryableHResult(int hResult)
        {
            return hResult == RPC_E_CALL_REJECTED ||
                   hResult == RPC_E_SERVERCALL_RETRYLATER ||
                   hResult == RPC_E_SERVERFAULT ||
                   hResult == RPC_S_CALL_FAILED ||
                   hResult == RPC_E_DISCONNECTED ||
                   hResult == CO_E_OBJNOTCONNECTED;
        }

        /// <summary>
        /// Determines if an exception indicates a retryable error.
        /// </summary>
        /// <param name="ex">The exception to check.</param>
        /// <returns>True if the error is retryable.</returns>
        public static bool IsRetryableException(Exception ex)
        {
            if (ex is COMException comEx)
            {
                return IsRetryableHResult(comEx.HResult);
            }
            return false;
        }

        /// <summary>
        /// Classifies a COM HRESULT into a ComErrorCode.
        /// </summary>
        /// <param name="hResult">The HRESULT error code.</param>
        /// <returns>The corresponding ComErrorCode.</returns>
        public static ComErrorCode ClassifyComError(int hResult)
        {
            return hResult switch
            {
                RPC_E_CALL_REJECTED => ComErrorCode.SwBusy,
                RPC_E_SERVERCALL_RETRYLATER => ComErrorCode.SwBusy,
                RPC_E_SERVERFAULT => ComErrorCode.RpcFailed,
                RPC_S_CALL_FAILED => ComErrorCode.RpcFailed,
                RPC_E_DISCONNECTED => ComErrorCode.SwUnresponsive,
                CO_E_OBJNOTCONNECTED => ComErrorCode.SwUnresponsive,
                unchecked((int)0x800401E3) => ComErrorCode.SwNotRunning, // MK_E_UNAVAILABLE
                _ => ComErrorCode.Unknown
            };
        }

        /// <summary>
        /// Gets a user-friendly error message for a COM HRESULT.
        /// </summary>
        /// <param name="hResult">The HRESULT error code.</param>
        /// <returns>A user-friendly error message.</returns>
        public static string GetUserFriendlyMessage(int hResult)
        {
            return hResult switch
            {
                RPC_E_CALL_REJECTED => "SolidWorks is busy processing another request. Please wait a moment and try again.",
                RPC_E_SERVERCALL_RETRYLATER => "SolidWorks is temporarily busy. Your request will be retried automatically.",
                RPC_E_SERVERFAULT => "SolidWorks encountered an internal error. Please try again.",
                RPC_S_CALL_FAILED => "Communication with SolidWorks failed. The application may be busy loading a file.",
                RPC_E_DISCONNECTED => "Lost connection to SolidWorks. The application may have closed unexpectedly.",
                CO_E_OBJNOTCONNECTED => "SolidWorks is no longer connected. Please ensure it is running.",
                unchecked((int)0x800401E3) => "SolidWorks is not running. Please start SolidWorks and try again.",
                _ => $"An unexpected COM error occurred (0x{hResult:X8}). Please try again."
            };
        }

        /// <summary>
        /// Gets the name of an HRESULT error code for logging.
        /// </summary>
        /// <param name="hResult">The HRESULT error code.</param>
        /// <returns>The error code name.</returns>
        private static string GetHResultName(int hResult)
        {
            return hResult switch
            {
                RPC_E_CALL_REJECTED => "RPC_E_CALL_REJECTED",
                RPC_E_SERVERCALL_RETRYLATER => "RPC_E_SERVERCALL_RETRYLATER",
                RPC_E_SERVERFAULT => "RPC_E_SERVERFAULT",
                RPC_S_CALL_FAILED => "RPC_S_CALL_FAILED",
                RPC_E_DISCONNECTED => "RPC_E_DISCONNECTED",
                CO_E_OBJNOTCONNECTED => "CO_E_OBJNOTCONNECTED",
                unchecked((int)0x800401E3) => "MK_E_UNAVAILABLE",
                _ => $"UNKNOWN_HRESULT"
            };
        }

        #endregion

        #region IDisposable

        /// <summary>
        /// Throws if the object has been disposed.
        /// </summary>
        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(ComStabilityLayer));
            }
        }

        /// <summary>
        /// Releases all resources used by the ComStabilityLayer.
        /// </summary>
        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        /// <summary>
        /// Releases the unmanaged resources and optionally releases the managed resources.
        /// </summary>
        /// <param name="disposing">True to release both managed and unmanaged resources.</param>
        protected virtual void Dispose(bool disposing)
        {
            if (_disposed)
                return;

            if (disposing)
            {
                Console.Error.WriteLine("[ComStability] Disposing COM stability layer...");

                // Stopping the pump unregisters the filter on the thread that registered
                // it, which is the only apartment where CoRegisterMessageFilter is valid.
                _staPump.Dispose();
                _messageFilter.Dispose();

                // Dispose semaphore
                _comCallSerializer.Dispose();

                Console.Error.WriteLine("[ComStability] Disposal complete");
            }

            _disposed = true;
        }

        /// <summary>
        /// Finalizer for ComStabilityLayer.
        /// </summary>
        ~ComStabilityLayer()
        {
            Dispose(false);
        }

        #endregion
    }

    #endregion
}
