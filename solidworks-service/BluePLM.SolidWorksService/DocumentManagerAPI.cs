using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Lightweight SolidWorks Document Manager API handler.
    /// Reads metadata, properties, BOM, configurations WITHOUT launching SolidWorks!
    /// 
    /// Requires a Document Manager API license key (free with SolidWorks subscription).
    /// Get yours at: https://customerportal.solidworks.com/ → API Support
    /// 
    /// Note: This feature dynamically loads the Document Manager DLL at runtime
    /// from the user's SolidWorks installation. Works on any machine with SolidWorks installed.
    /// </summary>
    public class DocumentManagerAPI : IDisposable
    {
        private object? _dmApp;
        private Assembly? _dmAssembly;
        private readonly string? _licenseKey;
        private bool _disposed;
        private bool _initialized;
        private string? _initError;

        // Common SolidWorks installation paths to search for the Document Manager DLL
        private static readonly string[] DllSearchPaths = new[]
        {
            @"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\api\redist\SolidWorks.Interop.swdocumentmgr.dll",
            @"C:\Program Files\SolidWorks Corp\SolidWorks\api\redist\SolidWorks.Interop.swdocumentmgr.dll",
            @"C:\Program Files (x86)\SOLIDWORKS Corp\SOLIDWORKS\api\redist\SolidWorks.Interop.swdocumentmgr.dll",
            @"C:\Program Files\Common Files\SolidWorks Shared\SolidWorks.Interop.swdocumentmgr.dll",
        };

        public DocumentManagerAPI(string? licenseKey = null)
        {
            _licenseKey = licenseKey;
        }

        public bool IsAvailable => _initialized && _dmApp != null;
        public string? InitializationError => _initError;

        #region Dynamic Assembly Loading

        /// <summary>
        /// Log a debug message to stderr (captured by Electron)
        /// </summary>
        private void LogDebug(string message)
        {
            Console.Error.WriteLine($"[DM-API] {message}");
        }

        /// <summary>
        /// Try to load the Document Manager assembly from the user's SolidWorks installation
        /// </summary>
        private bool TryLoadAssembly()
        {
            if (_dmAssembly != null) 
            {
                LogDebug("Assembly already loaded");
                return true;
            }

            LogDebug($"Searching for Document Manager DLL in {DllSearchPaths.Length} locations...");

            foreach (var path in DllSearchPaths)
            {
                LogDebug($"  Checking: {path}");
                if (File.Exists(path))
                {
                    LogDebug($"  Found DLL at: {path}");
                    try
                    {
                        _dmAssembly = Assembly.LoadFrom(path);
                        LogDebug($"  Successfully loaded assembly from: {path}");
                        return true;
                    }
                    catch (Exception ex)
                    {
                        LogDebug($"  FAILED to load from {path}: {ex.Message}");
                    }
                }
                else
                {
                    LogDebug($"  Not found at: {path}");
                }
            }

            // Also check environment variable for custom path
            var customPath = Environment.GetEnvironmentVariable("SOLIDWORKS_DM_DLL_PATH");
            LogDebug($"Checking SOLIDWORKS_DM_DLL_PATH env var: {(string.IsNullOrEmpty(customPath) ? "(not set)" : customPath)}");
            if (!string.IsNullOrEmpty(customPath) && File.Exists(customPath))
            {
                try
                {
                    _dmAssembly = Assembly.LoadFrom(customPath);
                    LogDebug($"Successfully loaded assembly from custom path: {customPath}");
                    return true;
                }
                catch (Exception ex)
                {
                    LogDebug($"FAILED to load from custom path {customPath}: {ex.Message}");
                }
            }

            LogDebug("Document Manager DLL not found in any search location");
            return false;
        }

        /// <summary>
        /// Get a type from the loaded Document Manager assembly
        /// </summary>
        private Type? GetDmType(string typeName)
        {
            return _dmAssembly?.GetType($"SolidWorks.Interop.swdocumentmgr.{typeName}");
        }

        #endregion

        #region Initialization

        public bool Initialize()
        {
            LogDebug("=== Initialize() called ===");
            
            if (_initialized) 
            {
                LogDebug($"Already initialized. _dmApp is {(_dmApp != null ? "available" : "null")}");
                return _dmApp != null;
            }

            try
            {
                // First, try to load the Document Manager DLL
                LogDebug("Step 1: Loading Document Manager DLL...");
                if (!TryLoadAssembly())
                {
                    _initError = "Document Manager DLL not found. Please ensure SolidWorks is installed. " +
                                 "You can also set SOLIDWORKS_DM_DLL_PATH environment variable to specify the DLL location.";
                    LogDebug($"FAILED: {_initError}");
                    _initialized = true;
                    return false;
                }
                LogDebug("Step 1: SUCCESS - DLL loaded");

                LogDebug("Step 2: Checking license key...");
                var key = _licenseKey ?? Environment.GetEnvironmentVariable("SOLIDWORKS_DM_LICENSE_KEY");
                
                if (string.IsNullOrEmpty(key))
                {
                    _initError = "Document Manager license key not provided. Set SOLIDWORKS_DM_LICENSE_KEY environment variable or use 'setDmLicense' command.";
                    LogDebug($"FAILED: {_initError}");
                    _initialized = true;
                    return false;
                }
                
                // Log key info (masked for security)
                var keyPrefix = key.Length > 30 ? key.Substring(0, 30) + "..." : key;
                var keyLength = key.Length;
                var hasCommas = key.Contains(",");
                var hasColon = key.Contains(":");
                LogDebug($"Step 2: SUCCESS - License key found");
                LogDebug($"  Key length: {keyLength} chars");
                LogDebug($"  Key prefix: {keyPrefix}");
                LogDebug($"  Has colon separator: {hasColon}");
                LogDebug($"  Has comma separators: {hasCommas}");
                if (hasCommas)
                {
                    var parts = key.Split(',');
                    LogDebug($"  Number of license components: {parts.Length}");
                    foreach (var part in parts)
                    {
                        var partType = part.Contains(":") ? part.Split(':')[1].Split('-')[0] : part.Split('-')[0];
                        LogDebug($"    - {partType} (len={part.Length})");
                    }
                }

                // Create SwDMClassFactory using COM ProgID (the proper way to instantiate COM objects)
                LogDebug("Step 3: Creating SwDMClassFactory via COM ProgID...");
                var factoryType = Type.GetTypeFromProgID("SwDocumentMgr.SwDMClassFactory");
                if (factoryType == null)
                {
                    // Fallback: try from loaded assembly (older approach)
                    LogDebug("  ProgID not found, trying from loaded assembly...");
                    factoryType = GetDmType("SwDMClassFactory");
                }
                
                if (factoryType == null)
                {
                    _initError = "Failed to find SwDMClassFactory type. Document Manager may not be installed.";
                    LogDebug($"FAILED: {_initError}");
                    // List available types for debugging
                    LogDebug("Available types in assembly:");
                    if (_dmAssembly != null)
                    {
                        foreach (var t in _dmAssembly.GetTypes().Take(20))
                        {
                            LogDebug($"  - {t.FullName}");
                        }
                    }
                    _initialized = true;
                    return false;
                }
                LogDebug($"Step 3: SUCCESS - Found SwDMClassFactory type: {factoryType.FullName}");

                LogDebug("Step 4: Creating factory instance...");
                var factory = Activator.CreateInstance(factoryType);
                if (factory == null)
                {
                    _initError = "Failed to create SwDMClassFactory instance.";
                    LogDebug($"FAILED: {_initError}");
                    _initialized = true;
                    return false;
                }
                LogDebug($"Step 4: SUCCESS - Factory instance created: {factory.GetType().FullName}");

                // Call GetApplication method
                LogDebug("Step 5: Looking for GetApplication method...");
                var getAppMethod = factoryType.GetMethod("ISwDMClassFactory_QueryInterface") ?? 
                                   factoryType.GetMethod("GetApplication");
                
                // Try to get the application through the interface
                var iFactoryType = GetDmType("ISwDMClassFactory");
                LogDebug($"  ISwDMClassFactory type: {(iFactoryType != null ? "found" : "not found")}");
                if (iFactoryType != null)
                {
                    getAppMethod = iFactoryType.GetMethod("GetApplication");
                    LogDebug($"  GetApplication from interface: {(getAppMethod != null ? "found" : "not found")}");
                }

                LogDebug("Step 6: Calling GetApplication with license key...");
                if (getAppMethod == null)
                {
                    // Try direct invocation via COM
                    LogDebug("  Using dynamic COM invocation...");
                    try
                    {
                        dynamic dynamicFactory = factory;
                        _dmApp = dynamicFactory.GetApplication(key);
                        LogDebug($"  Dynamic call result: {(_dmApp != null ? "SUCCESS" : "returned null")}");
                    }
                    catch (Exception ex)
                    {
                        _initError = $"Failed to call GetApplication: {ex.Message}";
                        LogDebug($"FAILED: {_initError}");
                        LogDebug($"  Exception type: {ex.GetType().Name}");
                        LogDebug($"  Stack trace: {ex.StackTrace}");
                        if (ex.InnerException != null)
                        {
                            LogDebug($"  Inner exception: {ex.InnerException.Message}");
                        }
                        _initialized = true;
                        return false;
                    }
                }
                else
                {
                    LogDebug("  Using reflection invoke...");
                    try
                    {
                        _dmApp = getAppMethod.Invoke(factory, new object[] { key });
                        LogDebug($"  Reflection call result: {(_dmApp != null ? "SUCCESS" : "returned null")}");
                    }
                    catch (Exception ex)
                    {
                        _initError = $"Failed to invoke GetApplication: {ex.Message}";
                        LogDebug($"FAILED: {_initError}");
                        LogDebug($"  Exception type: {ex.GetType().Name}");
                        if (ex.InnerException != null)
                        {
                            LogDebug($"  Inner exception: {ex.InnerException.Message}");
                        }
                        _initialized = true;
                        return false;
                    }
                }
                
                if (_dmApp == null)
                {
                    _initError = "Failed to initialize Document Manager. Check that the license key is valid.";
                    LogDebug($"FAILED: {_initError}");
                    LogDebug("  GetApplication returned null - this usually means the license key is invalid or expired");
                    _initialized = true;
                    return false;
                }

                LogDebug($"Step 6: SUCCESS - _dmApp created: {_dmApp.GetType().FullName}");
                LogDebug("=== Document Manager API initialized successfully! ===");
                _initialized = true;
                return true;
            }
            catch (Exception ex)
            {
                _initError = $"Document Manager initialization failed: {ex.Message}";
                LogDebug($"EXCEPTION during initialization: {ex.Message}");
                LogDebug($"  Exception type: {ex.GetType().Name}");
                LogDebug($"  Stack trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    LogDebug($"  Inner exception: {ex.InnerException.Message}");
                }
                _initialized = true;
                return false;
            }
        }

        public bool SetLicenseKey(string key)
        {
            LogDebug("=== SetLicenseKey() called ===");
            
            if (string.IsNullOrEmpty(key))
            {
                _initError = "License key cannot be empty";
                LogDebug($"FAILED: {_initError}");
                return false;
            }

            // Log key info (masked for security)
            var keyPrefix = key.Length > 30 ? key.Substring(0, 30) + "..." : key;
            LogDebug($"License key length: {key.Length} chars");
            LogDebug($"License key prefix: {keyPrefix}");
            LogDebug($"Has colon: {key.Contains(":")}");
            LogDebug($"Has commas: {key.Contains(",")}");
            if (key.Contains(","))
            {
                var parts = key.Split(',');
                LogDebug($"Number of license components: {parts.Length}");
            }

            LogDebug("Resetting state...");
            _disposed = false;
            _initialized = false;
            _dmApp = null;

            try
            {
                LogDebug("Loading assembly...");
                if (!TryLoadAssembly())
                {
                    _initError = "Document Manager DLL not found. Please ensure SolidWorks is installed.";
                    LogDebug($"FAILED: {_initError}");
                    return false;
                }
                LogDebug("Assembly loaded successfully");

                // Create factory using COM ProgID (the proper way to instantiate COM objects)
                LogDebug("Creating SwDMClassFactory via COM ProgID...");
                var factoryType = Type.GetTypeFromProgID("SwDocumentMgr.SwDMClassFactory");
                if (factoryType == null)
                {
                    // Fallback: try from loaded assembly (older approach)
                    LogDebug("ProgID not found, trying from loaded assembly...");
                    factoryType = GetDmType("SwDMClassFactory");
                }
                
                if (factoryType == null)
                {
                    _initError = "Failed to find SwDMClassFactory type. Document Manager may not be installed.";
                    LogDebug($"FAILED: {_initError}");
                    return false;
                }
                LogDebug($"Factory type found: {factoryType.FullName}");

                LogDebug("Creating factory instance...");
                var factory = Activator.CreateInstance(factoryType);
                if (factory == null)
                {
                    _initError = "Failed to create factory instance.";
                    LogDebug($"FAILED: {_initError}");
                    return false;
                }
                LogDebug("Factory instance created");

                LogDebug("Calling GetApplication with license key...");
                
                // Use reflection to call GetApplication (more reliable than dynamic binding)
                var iFactoryType = GetDmType("ISwDMClassFactory");
                System.Reflection.MethodInfo? getAppMethod = null;
                if (iFactoryType != null)
                {
                    getAppMethod = iFactoryType.GetMethod("GetApplication");
                    LogDebug($"  GetApplication from interface: {(getAppMethod != null ? "found" : "not found")}");
                }
                
                try
                {
                    if (getAppMethod != null)
                    {
                        LogDebug("  Using reflection invoke...");
                        _dmApp = getAppMethod.Invoke(factory, new object[] { key });
                        LogDebug($"  Reflection call result: {(_dmApp != null ? "SUCCESS" : "returned null")}");
                    }
                    else
                    {
                        // Fallback to dynamic (requires Microsoft.CSharp)
                        LogDebug("  Using dynamic COM invocation...");
                        dynamic dynamicFactory = factory;
                        _dmApp = dynamicFactory.GetApplication(key);
                        LogDebug($"  Dynamic call result: {(_dmApp != null ? "SUCCESS" : "returned null")}");
                    }
                }
                catch (Exception ex)
                {
                    _initError = $"Invalid license key: {ex.Message}";
                    LogDebug($"FAILED: {_initError}");
                    LogDebug($"Exception type: {ex.GetType().Name}");
                    if (ex.InnerException != null)
                    {
                        LogDebug($"Inner exception: {ex.InnerException.Message}");
                    }
                    _initialized = true;
                    return false;
                }
                
                if (_dmApp == null)
                {
                    _initError = "Invalid license key - GetApplication returned null";
                    LogDebug($"FAILED: {_initError}");
                    LogDebug("This usually means the license key format is incorrect or the key is invalid/expired");
                    _initialized = true;
                    return false;
                }

                LogDebug($"Document Manager application created: {_dmApp.GetType().FullName}");

                try 
                { 
                    Environment.SetEnvironmentVariable("SOLIDWORKS_DM_LICENSE_KEY", key, EnvironmentVariableTarget.User); 
                    LogDebug("Saved license key to user environment variable");
                }
                catch (Exception ex)
                {
                    LogDebug($"Warning: Could not save license key to environment: {ex.Message}");
                }

                _initialized = true;
                _initError = null;
                LogDebug("=== SetLicenseKey() completed successfully! ===");
                return true;
            }
            catch (Exception ex)
            {
                _initError = $"License key validation failed: {ex.Message}";
                LogDebug($"EXCEPTION: {_initError}");
                LogDebug($"Exception type: {ex.GetType().Name}");
                LogDebug($"Stack trace: {ex.StackTrace}");
                _initialized = true;
                return false;
            }
        }

        private object? OpenDocument(string filePath, out int error)
        {
            error = 0; // swDmDocumentOpenErrorNone
            
            if (_dmApp == null)
            {
                LogDebug("OpenDocument: _dmApp is null");
                error = 1; // swDmDocumentOpenErrorFail
                return null;
            }

            var docTypeInt = GetDocumentTypeValue(filePath);
            LogDebug($"OpenDocument: docType={docTypeInt} for {Path.GetFileName(filePath)}");
            if (docTypeInt == 0) // swDmDocumentUnknown
            {
                LogDebug("OpenDocument: Unknown document type");
                error = 2; // swDmDocumentOpenErrorFileNotFound
                return null;
            }

            try
            {
                // Get the enum types from the loaded assembly
                var docTypeEnumType = GetDmType("SwDmDocumentType");
                var errorEnumType = GetDmType("SwDmDocumentOpenError");
                
                if (docTypeEnumType == null || errorEnumType == null)
                {
                    LogDebug("OpenDocument: Could not find enum types in assembly");
                    error = 1;
                    return null;
                }
                
                // Convert int to the actual enum type
                var docTypeEnum = Enum.ToObject(docTypeEnumType, docTypeInt);
                LogDebug($"OpenDocument: Calling GetDocument with enum type {docTypeEnum}");
                
                // Use reflection to call GetDocument with proper enum types
                var appType = _dmApp.GetType();
                var getDocMethod = appType.GetMethod("ISwDMApplication_QueryInterface") ?? 
                                   appType.GetMethod("GetDocument");
                
                // Try using the ISwDMApplication interface
                var iAppType = GetDmType("ISwDMApplication");
                if (iAppType != null)
                {
                    getDocMethod = iAppType.GetMethod("GetDocument");
                }
                
                if (getDocMethod != null)
                {
                    LogDebug($"OpenDocument: Found GetDocument method via reflection");
                    var errorOut = Enum.ToObject(errorEnumType, 0);
                    var parameters = new object[] { filePath, docTypeEnum, true, errorOut };
                    var doc = getDocMethod.Invoke(_dmApp, parameters);
                    error = Convert.ToInt32(parameters[3]);
                    LogDebug($"OpenDocument: Reflection call returned, error={error}, doc={(doc != null ? "success" : "null")}");
                    
                    if (error != 0)
                    {
                        LogDecodeError(error);
                    }
                    return doc;
                }
                
                // Fallback: try dynamic with enum
                LogDebug("OpenDocument: Falling back to dynamic call with enum");
                dynamic app = _dmApp;
                dynamic errorEnum = Enum.ToObject(errorEnumType, 0);
                var result = app.GetDocument(filePath, docTypeEnum, true, out errorEnum);
                error = Convert.ToInt32(errorEnum);
                LogDebug($"OpenDocument: Dynamic call returned, error={error}, doc={(result != null ? "success" : "null")}");
                
                if (error != 0)
                {
                    LogDecodeError(error);
                }
                
                return result;
            }
            catch (Exception ex)
            {
                LogDebug($"OpenDocument: Exception - {ex.Message}");
                if (ex.InnerException != null)
                {
                    LogDebug($"OpenDocument: Inner exception - {ex.InnerException.Message}");
                }
                error = 1;
                return null;
            }
        }
        
        private void LogDecodeError(int error)
        {
            var errMsg = error switch
            {
                1 => "swDmDocumentOpenErrorFail - Generic failure (file locked or license issue?)",
                2 => "swDmDocumentOpenErrorFileNotFound",
                3 => "swDmDocumentOpenErrorFileReadOnly",
                4 => "swDmDocumentOpenErrorNonNativeFileType",
                5 => "swDmDocumentOpenErrorFileAlreadyOpened - File is open in another application",
                6 => "swDmDocumentOpenErrorFutureVersion - File from newer SolidWorks version",
                _ => $"Unknown error code: {error}"
            };
            LogDebug($"OpenDocument: Error - {errMsg}");
        }

        private int GetDocumentTypeValue(string filePath)
        {
            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            return ext switch
            {
                ".sldprt" => 1, // swDmDocumentPart
                ".sldasm" => 2, // swDmDocumentAssembly
                ".slddrw" => 3, // swDmDocumentDrawing
                _ => 0 // swDmDocumentUnknown
            };
        }

        #endregion

        #region Custom Properties (NO SW LAUNCH!)

        public CommandResult GetCustomProperties(string? filePath, string? configuration = null)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            object? doc = null;
            try
            {
                Console.Error.WriteLine($"[DM] Opening document: {filePath}");
                doc = OpenDocument(filePath!, out var openError);
                if (doc == null)
                {
                    Console.Error.WriteLine($"[DM] Failed to open document, error code: {openError}");
                    return new CommandResult { Success = false, Error = $"Failed to open file: error code {openError}" };
                }
                Console.Error.WriteLine($"[DM] Document opened successfully");

                dynamic dynDoc = doc;
                
                // Log document type
                var ext = Path.GetExtension(filePath).ToLowerInvariant();
                Console.Error.WriteLine($"[DM] File extension: {ext}");
                
                var fileProps = ReadProperties(dynDoc, null);
                Console.Error.WriteLine($"[DM] Read {fileProps.Count} file-level properties");
                
                // For drawings with no file-level properties, try additional methods
                if (ext == ".slddrw" && fileProps.Count == 0)
                {
                    Console.Error.WriteLine($"[DM] Drawing has no file-level properties, trying alternative methods...");
                    
                    // Try to list all available methods on the document object
                    try
                    {
                        var docType = ((object)dynDoc).GetType();
                        var methods = docType.GetMethods().Select(m => m.Name).Distinct().OrderBy(n => n).ToArray();
                        Console.Error.WriteLine($"[DM] Document object type: {docType.Name}");
                        Console.Error.WriteLine($"[DM] Available methods containing 'Property': {string.Join(", ", methods.Where(m => m.ToLower().Contains("property")))}");
                        Console.Error.WriteLine($"[DM] Available methods containing 'Custom': {string.Join(", ", methods.Where(m => m.ToLower().Contains("custom")))}");
                    }
                    catch (Exception typeEx)
                    {
                        Console.Error.WriteLine($"[DM] Error inspecting type: {typeEx.Message}");
                    }
                    
                    // Try GetCustomProperty2 if available (newer interface)
                    try
                    {
                        Console.Error.WriteLine($"[DM] Trying GetCustomProperty2 for known property names...");
                        string[] knownProps = { "Revision", "Rev", "Description", "Number", "PartNumber", "Part Number", "DrawnBy" };
                        foreach (var propName in knownProps)
                        {
                            try
                            {
                                object propType = null!;
                                object propValue = null!;
                                object resolved = null!;
                                
                                // Try GetCustomProperty first
                                try
                                {
                                    string val = dynDoc.GetCustomProperty(propName, out propType);
                                    if (!string.IsNullOrEmpty(val))
                                    {
                                        Console.Error.WriteLine($"[DM] Found via GetCustomProperty: '{propName}' = '{val}'");
                                        fileProps[propName] = val;
                                    }
                                }
                                catch { }
                                
                                // Try GetCustomProperty2 (returns value and resolved value)
                                try
                                {
                                    var result = dynDoc.GetCustomProperty2(propName, out propType, out propValue, out resolved);
                                    var valStr = propValue?.ToString() ?? resolved?.ToString();
                                    if (!string.IsNullOrEmpty(valStr))
                                    {
                                        Console.Error.WriteLine($"[DM] Found via GetCustomProperty2: '{propName}' = '{valStr}'");
                                        if (!fileProps.ContainsKey(propName))
                                            fileProps[propName] = valStr;
                                    }
                                }
                                catch { }
                            }
                            catch { }
                        }
                    }
                    catch (Exception propEx)
                    {
                        Console.Error.WriteLine($"[DM] Error trying known properties: {propEx.Message}");
                    }
                }
                
                var configNames = GetConfigurationNames(dynDoc);
                var configProps = new Dictionary<string, Dictionary<string, string>>();
                
                foreach (var config in configNames)
                {
                    if (configuration == null || config == configuration)
                    {
                        configProps[config] = ReadProperties(dynDoc, config);
                    }
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        fileProperties = fileProps,
                        configurationProperties = configProps,
                        configurations = configNames
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                }
            }
        }

        private Dictionary<string, string> ReadProperties(dynamic doc, string? configuration)
        {
            var props = new Dictionary<string, string>();

            try
            {
                if (string.IsNullOrEmpty(configuration))
                {
                    // Try to get property count first to verify the interface works
                    int propCount = 0;
                    try
                    {
                        propCount = doc.GetCustomPropertyCount();
                        Console.Error.WriteLine($"[DM] GetCustomPropertyCount: {propCount}");
                    }
                    catch (Exception countEx)
                    {
                        Console.Error.WriteLine($"[DM] GetCustomPropertyCount exception: {countEx.Message}");
                    }
                    
                    // Try GetCustomPropertyNames
                    object? propNamesObj = null;
                    try
                    {
                        propNamesObj = doc.GetCustomPropertyNames();
                        Console.Error.WriteLine($"[DM] GetCustomPropertyNames returned: {(propNamesObj == null ? "null" : propNamesObj.GetType().Name)}");
                    }
                    catch (Exception namesEx)
                    {
                        Console.Error.WriteLine($"[DM] GetCustomPropertyNames exception: {namesEx.Message}");
                    }
                    
                    var propNames = propNamesObj as string[];
                    if (propNames != null && propNames.Length > 0)
                    {
                        Console.Error.WriteLine($"[DM] Found {propNames.Length} property names: {string.Join(", ", propNames)}");
                        
                        // Get the SwDmCustomInfoType enum type for proper COM interop
                        var customInfoType = GetDmType("SwDmCustomInfoType");
                        
                        foreach (var name in propNames)
                        {
                            try
                            {
                                string? value = null;
                                
                                // Method 1: Use reflection to call GetCustomProperty with proper enum type
                                if (customInfoType != null)
                                {
                                    try
                                    {
                                        var docType = ((object)doc).GetType();
                                        var getMethod = docType.GetMethod("ISwDMDocument_GetCustomProperty") ??
                                                       docType.GetMethod("GetCustomProperty");
                                        
                                        if (getMethod != null)
                                        {
                                            var enumDefault = Enum.ToObject(customInfoType, 0);
                                            var parameters = new object[] { name, enumDefault };
                                            value = getMethod.Invoke(doc, parameters)?.ToString();
                                        }
                                    }
                                    catch { }
                                }
                                
                                // Method 2: Try using dynamic with the correct parameter order
                                if (string.IsNullOrEmpty(value))
                                {
                                    try
                                    {
                                        // Some COM objects accept the out param differently
                                        var result = ((object)doc).GetType().InvokeMember(
                                            "GetCustomProperty",
                                            System.Reflection.BindingFlags.InvokeMethod,
                                            null,
                                            doc,
                                            new object[] { name, 0 }
                                        );
                                        value = result?.ToString();
                                    }
                                    catch { }
                                }
                                
                                // Method 3: Try the resolved value directly
                                if (string.IsNullOrEmpty(value))
                                {
                                    try
                                    {
                                        // Try GetCustomPropertyValue if available
                                        value = doc.GetCustomPropertyValue(name);
                                    }
                                    catch { }
                                }
                                
                                if (!string.IsNullOrEmpty(value))
                                {
                                    Console.Error.WriteLine($"[DM] Property '{name}' = '{value}'");
                                    props[name] = value;
                                }
                                else
                                {
                                    Console.Error.WriteLine($"[DM] Property '{name}' returned empty/null");
                                }
                            }
                            catch (Exception propEx)
                            {
                                Console.Error.WriteLine($"[DM] Error reading property '{name}': {propEx.Message}");
                            }
                        }
                    }
                    else if (propCount > 0)
                    {
                        // We have properties but GetCustomPropertyNames returned empty
                        // Try iterating by index using GetCustomPropertyByIndex (if available)
                        Console.Error.WriteLine($"[DM] Trying GetCustomPropertyByIndex for {propCount} properties...");
                        for (int i = 0; i < propCount; i++)
                        {
                            try
                            {
                                object propName = null!;
                                object propType = null!;
                                object propValue = null!;
                                string? name = null;
                                string? value = null;
                                
                                // Try different methods to get property by index
                                try
                                {
                                    var result = doc.GetCustomPropertyByIndex(i, out propName, out propType, out propValue);
                                    name = propName?.ToString();
                                    value = propValue?.ToString();
                                }
                                catch
                                {
                                    // Try alternative: GetCustomPropertyName and then GetCustomProperty
                                    try
                                    {
                                        name = doc.GetCustomPropertyName(i);
                                        if (!string.IsNullOrEmpty(name))
                                        {
                                            value = doc.GetCustomProperty(name, out propType);
                                        }
                                    }
                                    catch { }
                                }
                                
                                if (!string.IsNullOrEmpty(name))
                                {
                                    Console.Error.WriteLine($"[DM] Property[{i}] '{name}' = '{value}'");
                                    props[name] = value ?? "";
                                }
                            }
                            catch (Exception indexEx)
                            {
                                Console.Error.WriteLine($"[DM] Error reading property at index {i}: {indexEx.Message}");
                            }
                        }
                    }
                    else
                    {
                        Console.Error.WriteLine($"[DM] No properties found at file level");
                    }
                }
                else
                {
                    Console.Error.WriteLine($"[DM] Reading config-level properties for: {configuration}");
                    try
                    {
                        var configMgr = doc.ConfigurationManager;
                        if (configMgr == null)
                        {
                            Console.Error.WriteLine($"[DM] ConfigurationManager is null");
                            return props;
                        }
                        
                        var config = configMgr.GetConfigurationByName(configuration);
                        if (config != null)
                        {
                            var propNames = (string[]?)config.GetCustomPropertyNames();
                            if (propNames != null)
                            {
                                Console.Error.WriteLine($"[DM] Config '{configuration}' has {propNames.Length} properties");
                                
                                // Get the SwDmCustomInfoType enum type for proper COM interop
                                var customInfoType = GetDmType("SwDmCustomInfoType");
                                
                                foreach (var name in propNames)
                                {
                                    try
                                    {
                                        string? value = null;
                                        
                                        // Method 1: Use reflection with proper enum type
                                        if (customInfoType != null)
                                        {
                                            try
                                            {
                                                var configType = ((object)config).GetType();
                                                var getMethod = configType.GetMethod("ISwDMConfiguration_GetCustomProperty") ??
                                                               configType.GetMethod("GetCustomProperty");
                                                
                                                if (getMethod != null)
                                                {
                                                    var enumDefault = Enum.ToObject(customInfoType, 0);
                                                    var parameters = new object[] { name, enumDefault };
                                                    value = getMethod.Invoke(config, parameters)?.ToString();
                                                }
                                            }
                                            catch { }
                                        }
                                        
                                        // Method 2: Try using InvokeMember with integer enum value
                                        if (string.IsNullOrEmpty(value))
                                        {
                                            try
                                            {
                                                var result = ((object)config).GetType().InvokeMember(
                                                    "GetCustomProperty",
                                                    System.Reflection.BindingFlags.InvokeMethod,
                                                    null,
                                                    config,
                                                    new object[] { name, 0 }
                                                );
                                                value = result?.ToString();
                                            }
                                            catch { }
                                        }
                                        
                                        // Method 3: Try dynamic with cast to int
                                        if (string.IsNullOrEmpty(value))
                                        {
                                            try
                                            {
                                                dynamic dynConfig = config;
                                                int outType = 0;
                                                value = dynConfig.GetCustomProperty(name, out outType);
                                            }
                                            catch { }
                                        }
                                        
                                        if (!string.IsNullOrEmpty(value))
                                        {
                                            props[name] = value;
                                            Console.Error.WriteLine($"[DM] Config property '{name}' = '{value}'");
                                        }
                                    }
                                    catch (Exception propEx)
                                    {
                                        Console.Error.WriteLine($"[DM] Error reading config property '{name}': {propEx.Message}");
                                    }
                                }
                            }
                        }
                        else
                        {
                            Console.Error.WriteLine($"[DM] Configuration '{configuration}' not found");
                        }
                    }
                    catch (Exception configEx)
                    {
                        Console.Error.WriteLine($"[DM] Error reading config properties: {configEx.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[DM] ReadProperties exception: {ex.Message}");
            }

            return props;
        }

        /// <summary>
        /// Read custom properties from the drawing's referenced model.
        /// Drawing properties are often actually stored on the referenced part/assembly,
        /// not on the drawing file itself. This is by design in SolidWorks.
        /// </summary>
        private Dictionary<string, string> ReadDrawingReferencedModelProperties(dynamic doc, string drawingPath)
        {
            var props = new Dictionary<string, string>();

            try
            {
                Console.Error.WriteLine($"[DM] Attempting to read properties from drawing's referenced model...");
                
                // Get external references (the models this drawing references)
                try
                {
                    // Create search options to find parts and assemblies
                    var searchOptType = GetDmType("SwDMSearchOption");
                    if (searchOptType != null)
                    {
                        var searchOpt = Activator.CreateInstance(searchOptType);
                        if (searchOpt != null)
                        {
                            dynamic dynSearchOpt = searchOpt;
                            dynSearchOpt.SearchFilters = 3; // swDmSearchForPart | swDmSearchForAssembly
                            
                            var references = (string[]?)doc.GetAllExternalReferences(searchOpt);
                            
                            if (references != null && references.Length > 0)
                            {
                                Console.Error.WriteLine($"[DM] Drawing references {references.Length} models");
                                
                                // The first reference is typically the main model for the drawing
                                var primaryModelPath = references[0];
                                Console.Error.WriteLine($"[DM] Primary referenced model: {Path.GetFileName(primaryModelPath)}");
                                
                                // Check if the file exists and try to read its properties
                                if (File.Exists(primaryModelPath))
                                {
                                    // Open the referenced model to read its properties
                                    var modelDoc = OpenDocument(primaryModelPath, out var modelOpenError);
                                    if (modelDoc != null)
                                    {
                                        try
                                        {
                                            Console.Error.WriteLine($"[DM] Opened referenced model, reading properties...");
                                            dynamic dynModelDoc = modelDoc;
                                            
                                            // Read file-level properties
                                            props = ReadProperties(dynModelDoc, null);
                                            Console.Error.WriteLine($"[DM] Read {props.Count} properties from referenced model");
                                            
                                            // If no file-level properties, try default configuration
                                            if (props.Count == 0)
                                            {
                                                try
                                                {
                                                    var configMgr = dynModelDoc.ConfigurationManager;
                                                    if (configMgr != null)
                                                    {
                                                        var activeConfig = configMgr.GetActiveConfigurationName();
                                                        if (!string.IsNullOrEmpty(activeConfig))
                                                        {
                                                            Console.Error.WriteLine($"[DM] Trying active config: {activeConfig}");
                                                            props = ReadProperties(dynModelDoc, activeConfig);
                                                            Console.Error.WriteLine($"[DM] Read {props.Count} config properties from referenced model");
                                                        }
                                                    }
                                                }
                                                catch (Exception configEx)
                                                {
                                                    Console.Error.WriteLine($"[DM] Error reading config properties: {configEx.Message}");
                                                }
                                            }
                                        }
                                        finally
                                        {
                                            try { ((dynamic)modelDoc).CloseDoc(); } catch { }
                                        }
                                    }
                                    else
                                    {
                                        Console.Error.WriteLine($"[DM] Failed to open referenced model, error: {modelOpenError}");
                                    }
                                }
                                else
                                {
                                    Console.Error.WriteLine($"[DM] Referenced model file not found: {primaryModelPath}");
                                }
                            }
                            else
                            {
                                Console.Error.WriteLine($"[DM] No external references found in drawing");
                            }
                        }
                    }
                    else
                    {
                        Console.Error.WriteLine($"[DM] SwDMSearchOption type not found");
                    }
                }
                catch (Exception refEx)
                {
                    Console.Error.WriteLine($"[DM] Error getting external references: {refEx.Message}");
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[DM] ReadDrawingReferencedModelProperties failed: {ex.Message}");
            }

            return props;
        }

        /// <summary>
        /// Set custom properties on a file WITHOUT launching SolidWorks!
        /// Can set file-level or configuration-specific properties.
        /// </summary>
        public CommandResult SetCustomProperties(string? filePath, Dictionary<string, string>? properties, string? configuration = null)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            if (properties == null || properties.Count == 0)
                return new CommandResult { Success = false, Error = "Missing or empty 'properties'" };

            object? doc = null;
            try
            {
                // Open document for WRITE access (not read-only)
                doc = OpenDocumentForWrite(filePath!, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file for writing: error code {openError}" };

                dynamic dynDoc = doc;
                int propsSet = 0;
                const int swDmCustomInfoText = 2;

                if (string.IsNullOrEmpty(configuration))
                {
                    // Set file-level properties
                    foreach (var kvp in properties)
                    {
                        try
                        {
                            try { dynDoc.DeleteCustomProperty(kvp.Key); } catch { }
                            dynDoc.AddCustomProperty(kvp.Key, swDmCustomInfoText, kvp.Value);
                            propsSet++;
                        }
                        catch
                        {
                            try 
                            { 
                                dynDoc.SetCustomProperty(kvp.Key, kvp.Value);
                                propsSet++; 
                            } 
                            catch { }
                        }
                    }
                }
                else
                {
                    // Set configuration-specific properties
                    var configMgr = dynDoc.ConfigurationManager;
                    var config = configMgr.GetConfigurationByName(configuration);
                    if (config == null)
                    {
                        return new CommandResult { Success = false, Error = $"Configuration not found: {configuration}" };
                    }

                    foreach (var kvp in properties)
                    {
                        try
                        {
                            try { config.DeleteCustomProperty(kvp.Key); } catch { }
                            config.AddCustomProperty(kvp.Key, swDmCustomInfoText, kvp.Value);
                            propsSet++;
                        }
                        catch
                        {
                            try 
                            { 
                                config.SetCustomProperty(kvp.Key, kvp.Value);
                                propsSet++; 
                            } 
                            catch { }
                        }
                    }
                }

                // Save the document
                dynDoc.Save();

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        propertiesSet = propsSet,
                        configuration = configuration ?? "file-level"
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                }
            }
        }

        /// <summary>
        /// Set custom properties on MULTIPLE configurations in one document open/save cycle.
        /// MUCH faster than calling SetCustomProperties multiple times!
        /// </summary>
        /// <param name="filePath">Path to the SolidWorks file</param>
        /// <param name="configProperties">Dictionary mapping configuration name -> property dictionary</param>
        public CommandResult SetCustomPropertiesBatch(string? filePath, Dictionary<string, Dictionary<string, string>>? configProperties)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            if (configProperties == null || configProperties.Count == 0)
                return new CommandResult { Success = false, Error = "Missing or empty 'configProperties'" };

            object? doc = null;
            try
            {
                Console.Error.WriteLine($"[DM] SetCustomPropertiesBatch: Opening {Path.GetFileName(filePath)} for {configProperties.Count} configs");
                
                // Open document for WRITE access ONCE
                doc = OpenDocumentForWrite(filePath!, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file for writing: error code {openError}" };

                dynamic dynDoc = doc;
                var configMgr = dynDoc.ConfigurationManager;
                const int swDmCustomInfoText = 2;
                
                int totalPropsSet = 0;
                int configsProcessed = 0;
                var errors = new List<string>();

                // Write properties to each configuration
                foreach (var configEntry in configProperties)
                {
                    var configName = configEntry.Key;
                    var properties = configEntry.Value;
                    
                    if (properties == null || properties.Count == 0)
                        continue;

                    try
                    {
                        var config = configMgr.GetConfigurationByName(configName);
                        if (config == null)
                        {
                            errors.Add($"Configuration not found: {configName}");
                            continue;
                        }

                        int propsSetForConfig = 0;
                        foreach (var kvp in properties)
                        {
                            try
                            {
                                try { config.DeleteCustomProperty(kvp.Key); } catch { }
                                config.AddCustomProperty(kvp.Key, swDmCustomInfoText, kvp.Value);
                                propsSetForConfig++;
                            }
                            catch
                            {
                                try 
                                { 
                                    config.SetCustomProperty(kvp.Key, kvp.Value);
                                    propsSetForConfig++; 
                                } 
                                catch { }
                            }
                        }
                        
                        totalPropsSet += propsSetForConfig;
                        configsProcessed++;
                        Console.Error.WriteLine($"[DM] Config '{configName}': set {propsSetForConfig} properties");
                    }
                    catch (Exception configEx)
                    {
                        errors.Add($"Error writing to config '{configName}': {configEx.Message}");
                    }
                }

                // Save the document ONCE after all writes
                Console.Error.WriteLine($"[DM] Saving document...");
                dynDoc.Save();
                Console.Error.WriteLine($"[DM] Saved! {configsProcessed} configs, {totalPropsSet} properties total");

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        configurationsProcessed = configsProcessed,
                        propertiesSet = totalPropsSet,
                        errors = errors.Count > 0 ? errors : null
                    }
                };
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[DM] SetCustomPropertiesBatch error: {ex.Message}");
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                }
            }
        }

        /// <summary>
        /// Open document for write access (not read-only)
        /// </summary>
        private object? OpenDocumentForWrite(string filePath, out int error)
        {
            error = 0;

            if (_dmApp == null)
            {
                error = 1;
                return null;
            }

            var docType = GetDocumentTypeValue(filePath);
            if (docType == 0)
            {
                error = 1;
                return null;
            }

            try
            {
                dynamic app = _dmApp;
                // Open with write access (readOnly = false)
                return app.GetDocument(filePath, docType, false, out error);
            }
            catch
            {
                error = 1;
                return null;
            }
        }

        #endregion

        #region Configurations (NO SW LAUNCH!)

        public CommandResult GetConfigurations(string? filePath)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            object? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: error code {openError}" };

                dynamic dynDoc = doc;
                var configNames = GetConfigurationNames(dynDoc);
                var configs = new List<object>();
                var activeConfig = (string)dynDoc.ConfigurationManager.GetActiveConfigurationName();

                foreach (var name in configNames)
                {
                    var config = dynDoc.ConfigurationManager.GetConfigurationByName(name);
                    var props = ReadProperties(dynDoc, name);
                    
                    // Try to get parent configuration name (for derived configurations)
                    string? parentConfig = null;
                    try
                    {
                        parentConfig = config?.GetParentConfigurationName();
                        if (string.IsNullOrEmpty(parentConfig))
                            parentConfig = null;
                    }
                    catch { }

                    configs.Add(new
                    {
                        name,
                        isActive = name == activeConfig,
                        description = config?.Description ?? "",
                        parentConfiguration = parentConfig,
                        properties = props
                    });
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        activeConfiguration = activeConfig,
                        configurations = configs,
                        count = configs.Count
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                }
            }
        }

        private string[] GetConfigurationNames(dynamic doc)
        {
            try
            {
                var names = (string[]?)doc.ConfigurationManager.GetConfigurationNames();
                return names ?? Array.Empty<string>();
            }
            catch
            {
                return Array.Empty<string>();
            }
        }

        #endregion

        #region BOM / References (NO SW LAUNCH!)

        public CommandResult GetBillOfMaterials(string? filePath, string? configuration = null)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            var ext = Path.GetExtension(filePath).ToLowerInvariant();
            if (ext != ".sldasm")
                return new CommandResult { Success = false, Error = "BOM extraction only works on assembly files (.sldasm)" };

            object? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: error code {openError}" };

                dynamic dynDoc = doc;
                var bom = new List<BomItem>();
                var quantities = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

                var configName = configuration ?? (string)dynDoc.ConfigurationManager.GetActiveConfigurationName();
                
                // Get external references using reflection
                var searchOptType = GetDmType("SwDMSearchOptionClass");
                if (searchOptType != null)
                {
                    var searchOpt = Activator.CreateInstance(searchOptType);
                    if (searchOpt != null)
                    {
                        dynamic dynSearchOpt = searchOpt;
                        dynSearchOpt.SearchFilters = 3; // SwDmSearchForPart | SwDmSearchForAssembly

                        var dependencies = (string[]?)dynDoc.GetAllExternalReferences(searchOpt);

                        if (dependencies != null)
                        {
                            foreach (var depPath in dependencies)
                            {
                                if (string.IsNullOrEmpty(depPath)) continue;

                                if (quantities.ContainsKey(depPath))
                                    quantities[depPath]++;
                                else
                                    quantities[depPath] = 1;
                            }

                            var processed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            foreach (var depPath in dependencies)
                            {
                                if (string.IsNullOrEmpty(depPath) || processed.Contains(depPath)) continue;
                                if (!File.Exists(depPath)) continue;
                                processed.Add(depPath);

                                var depExt = Path.GetExtension(depPath).ToLowerInvariant();
                                var fileType = depExt == ".sldprt" ? "Part" : depExt == ".sldasm" ? "Assembly" : "Other";

                                var props = new Dictionary<string, string>();
                                object? compDoc = null;
                                try
                                {
                                    compDoc = OpenDocument(depPath, out _);
                                    if (compDoc != null)
                                    {
                                        dynamic dynCompDoc = compDoc;
                                        props = ReadProperties(dynCompDoc, null);
                                    }
                                }
                                catch { }
                                finally
                                {
                                    // ALWAYS close component documents
                                    if (compDoc != null)
                                    {
                                        try { ((dynamic)compDoc).CloseDoc(); } catch { }
                                    }
                                }

                                bom.Add(new BomItem
                                {
                                    FileName = Path.GetFileName(depPath),
                                    FilePath = depPath,
                                    FileType = fileType,
                                    Quantity = quantities[depPath],
                                    Configuration = "",
                                    PartNumber = GetPartNumber(props),
                                    Description = GetDictValue(props, "Description") ?? "",
                                    Material = GetDictValue(props, "Material") ?? "",
                                    Revision = GetRevision(props),
                                    Properties = props
                                });
                            }
                        }
                    }
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        assemblyPath = filePath,
                        configuration = configName,
                        items = bom,
                        totalParts = bom.Count,
                        totalQuantity = bom.Sum(b => b.Quantity)
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                }
            }
        }

        public CommandResult GetExternalReferences(string? filePath)
        {
            if (!Initialize() || _dmApp == null)
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            object? doc = null;
            try
            {
                doc = OpenDocument(filePath!, out var openError);
                if (doc == null)
                    return new CommandResult { Success = false, Error = $"Failed to open file: error code {openError}" };

                dynamic dynDoc = doc;
                var references = new List<object>();
                
                var searchOptType = GetDmType("SwDMSearchOptionClass");
                if (searchOptType != null)
                {
                    var searchOpt = Activator.CreateInstance(searchOptType);
                    if (searchOpt != null)
                    {
                        dynamic dynSearchOpt = searchOpt;
                        dynSearchOpt.SearchFilters = 7; // Part | Assembly | Drawing

                        var dependencies = (string[]?)dynDoc.GetAllExternalReferences(searchOpt);

                        if (dependencies != null)
                        {
                            var processed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            foreach (var depPath in dependencies)
                            {
                                if (string.IsNullOrEmpty(depPath) || processed.Contains(depPath)) continue;
                                processed.Add(depPath);

                                var depExt = Path.GetExtension(depPath).ToLowerInvariant();
                                references.Add(new
                                {
                                    path = depPath,
                                    fileName = Path.GetFileName(depPath),
                                    exists = File.Exists(depPath),
                                    fileType = depExt == ".sldprt" ? "Part" : depExt == ".sldasm" ? "Assembly" : depExt == ".slddrw" ? "Drawing" : "Other"
                                });
                            }
                        }
                    }
                }

                return new CommandResult
                {
                    Success = true,
                    Data = new
                    {
                        filePath,
                        references,
                        count = references.Count
                    }
                };
            }
            catch (Exception ex)
            {
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                }
            }
        }

        #endregion

        #region Preview Extraction (NO SW LAUNCH!)

        /// <summary>
        /// Extract high-resolution preview image from a SolidWorks file.
        /// Returns the image as a base64-encoded BMP string.
        /// </summary>
        public CommandResult GetPreviewImage(string? filePath, string? configuration = null)
        {
            LogDebug($"GetPreviewImage called for: {filePath}, config: {configuration ?? "(default)"}");
            
            if (!Initialize() || _dmApp == null)
            {
                LogDebug($"DM API not available: {_initError}");
                return new CommandResult { Success = false, Error = _initError ?? "Document Manager not available" };
            }

            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "Missing 'filePath'" };

            if (!File.Exists(filePath))
                return new CommandResult { Success = false, Error = $"File not found: {filePath}" };

            object? doc = null;
            try
            {
                LogDebug("Opening document...");
                doc = OpenDocument(filePath!, out var openError);
                if (doc == null)
                {
                    LogDebug($"Failed to open document, error code: {openError}");
                    return new CommandResult { Success = false, Error = $"Failed to open file: error code {openError}" };
                }
                LogDebug("Document opened successfully");

                dynamic dynDoc = doc;
                object? previewBitmap = null;
                int previewError = -1;
                
                // First, try to get preview via ConfigurationManager (this is how PDM does it)
                LogDebug("Trying to get preview via ConfigurationManager...");
                try
                {
                    var configMgr = dynDoc.ConfigurationManager;
                    if (configMgr != null)
                    {
                        LogDebug($"ConfigurationManager type: {configMgr.GetType().Name}");
                        
                        // Get configuration names
                        string[]? configNames = null;
                        try
                        {
                            configNames = configMgr.GetConfigurationNames() as string[];
                            if (configNames != null && configNames.Length > 0)
                            {
                                LogDebug($"Found {configNames.Length} configurations: {string.Join(", ", configNames.Take(5))}");
                            }
                        }
                        catch { }
                        
                        // Get the active configuration or use the specified one
                        string targetConfig = configuration ?? "";
                        if (string.IsNullOrEmpty(targetConfig) && configNames != null && configNames.Length > 0)
                        {
                            // Try to get active configuration
                            try
                            {
                                targetConfig = dynDoc.ActiveConfiguration?.Name ?? configNames[0];
                            }
                            catch
                            {
                                targetConfig = configNames[0];
                            }
                        }
                        
                        if (!string.IsNullOrEmpty(targetConfig))
                        {
                            LogDebug($"Getting configuration: {targetConfig}");
                            try
                            {
                                dynamic config = configMgr.GetConfigurationByName(targetConfig);
                                if (config != null)
                                {
                                    LogDebug($"Configuration type: {config.GetType().Name}");
                                    
                                    // List methods on configuration
                                    var configType = ((object)config).GetType();
                                    var configInterfaces = configType.GetInterfaces();
                                    LogDebug($"Configuration implements {configInterfaces.Length} interfaces");
                                    foreach (var iface in configInterfaces.Where(i => i.Name.Contains("Configuration")).Take(5))
                                    {
                                        LogDebug($"  - {iface.Name}");
                                        var previewMeth = iface.GetMethod("GetPreviewBitmap") ?? iface.GetMethod("GetPreviewPNGBitmapData");
                                        if (previewMeth != null)
                                        {
                                            LogDebug($"    Found preview method: {previewMeth.Name}");
                                        }
                                    }
                                    
                                    // Try GetPreviewBitmap on configuration using reflection
                                    var previewErrorType = GetDmType("SwDmPreviewError");
                                    LogDebug($"SwDmPreviewError enum type: {previewErrorType?.FullName ?? "NOT FOUND"}");
                                    
                                    // Find GetPreviewBitmap on ISwDMConfiguration interfaces
                                    var configObjType = ((object)config).GetType();
                                    var configInterfaces2 = configObjType.GetInterfaces();
                                    
                                    foreach (var cfgIface in configInterfaces2.Where(i => i.Name.Contains("Configuration")).OrderByDescending(i => i.Name))
                                    {
                                        var previewMeth = cfgIface.GetMethod("GetPreviewBitmap");
                                        if (previewMeth != null)
                                        {
                                            LogDebug($"Trying {cfgIface.Name}.GetPreviewBitmap via reflection...");
                                            try
                                            {
                                                // Create properly typed enum argument
                                                object errorArg = previewErrorType != null 
                                                    ? Enum.ToObject(previewErrorType, 0) 
                                                    : 0;
                                                object[] args = new object[] { errorArg };
                                                
                                                var result = previewMeth.Invoke(config, args);
                                                previewError = Convert.ToInt32(args[0]);
                                                
                                                LogDebug($"Config GetPreviewBitmap result: {(result != null ? result.GetType().Name : "null")}, error={previewError}");
                                                
                                                if (result is byte[] bmpData && bmpData.Length > 0 && previewError == 0)
                                                {
                                                    LogDebug($"SUCCESS! Got preview from configuration: {bmpData.Length} bytes");
                                                    previewBitmap = bmpData;
                                                    break;
                                                }
                                            }
                                            catch (TargetInvocationException tie)
                                            {
                                                var inner = tie.InnerException ?? tie;
                                                LogDebug($"Config GetPreviewBitmap failed: {inner.GetType().Name}: {inner.Message}");
                                                if (inner is System.Runtime.InteropServices.COMException comEx)
                                                {
                                                    LogDebug($"COM Error: 0x{comEx.ErrorCode:X8}");
                                                }
                                            }
                                            catch (Exception ex)
                                            {
                                                LogDebug($"Config GetPreviewBitmap failed: {ex.Message}");
                                            }
                                        }
                                    }
                                    
                                    // If we got a preview, process it
                                    if (previewBitmap is byte[] configBmpData && configBmpData.Length > 0)
                                    {
                                        // Convert DIB to BMP and return
                                        var bmpBytes = ConvertDibToBmp(configBmpData);
                                        if (bmpBytes != null && bmpBytes.Length > 0)
                                        {
                                            LogDebug($"Converted DIB to BMP: {bmpBytes.Length} bytes");
                                            return new CommandResult
                                            {
                                                Success = true,
                                                Data = new
                                                {
                                                    filePath,
                                                    configuration = targetConfig,
                                                    imageData = Convert.ToBase64String(bmpBytes),
                                                    mimeType = "image/bmp",
                                                    sizeBytes = bmpBytes.Length
                                                }
                                            };
                                        }
                                    }
                                }
                            }
                            catch (Exception configEx)
                            {
                                LogDebug($"GetConfigurationByName failed: {configEx.Message}");
                            }
                        }
                    }
                }
                catch (Exception cfgMgrEx)
                {
                    LogDebug($"ConfigurationManager access failed: {cfgMgrEx.Message}");
                }

                // Fall back to document-level preview
                if (previewBitmap == null)
                {
                    LogDebug("Trying document-level preview...");
                    
                    // List interfaces implemented by the document object
                    var docType = doc.GetType();
                    var interfaces = docType.GetInterfaces();
                    LogDebug($"Document implements {interfaces.Length} interfaces:");
                    foreach (var iface in interfaces.Take(10))
                    {
                        LogDebug($"  - {iface.Name}");
                    }
                    
                    // Try to find and call GetPreviewBitmap on the correct interface
                    // The method is on ISwDMDocument, not SwDMDocumentClass
                    MethodInfo? previewMethod = null;
                    Type? targetInterface = null;
                    
                    // Search for GetPreviewPNGBitmapData first (newer, returns PNG)
                    foreach (var iface in interfaces)
                    {
                        if (iface.Name.StartsWith("ISwDMDocument"))
                        {
                            var method = iface.GetMethod("GetPreviewPNGBitmapData");
                            if (method != null)
                            {
                                LogDebug($"Found GetPreviewPNGBitmapData on {iface.Name}");
                                previewMethod = method;
                                targetInterface = iface;
                                break;
                            }
                        }
                    }
                    
                    // Try GetPreviewPNGBitmapData
                    if (previewMethod != null)
                    {
                        LogDebug("Calling GetPreviewPNGBitmapData via interface...");
                        try
                        {
                            object[] args = new object[] { 0 };
                            var result = previewMethod.Invoke(doc, args);
                            previewError = Convert.ToInt32(args[0]);
                            
                            LogDebug($"GetPreviewPNGBitmapData result: {(result != null ? result.GetType().Name : "null")}, error={previewError}");
                            
                            if (result is byte[] pngBytes && pngBytes.Length > 0 && previewError == 0)
                            {
                                LogDebug($"SUCCESS! Got PNG preview: {pngBytes.Length} bytes");
                                return new CommandResult
                                {
                                    Success = true,
                                    Data = new
                                    {
                                        filePath,
                                        configuration = configuration ?? "default",
                                        imageData = Convert.ToBase64String(pngBytes),
                                        mimeType = "image/png",
                                        sizeBytes = pngBytes.Length
                                    }
                                };
                            }
                        }
                        catch (Exception pngEx)
                        {
                            var inner = (pngEx as TargetInvocationException)?.InnerException ?? pngEx;
                            LogDebug($"GetPreviewPNGBitmapData failed: {inner.GetType().Name}: {inner.Message}");
                        }
                    }
                    
                    // Search for GetPreviewBitmap (fallback, returns DIB)
                    previewMethod = null;
                    foreach (var iface in interfaces)
                    {
                        if (iface.Name.StartsWith("ISwDMDocument"))
                        {
                            var method = iface.GetMethod("GetPreviewBitmap");
                            if (method != null)
                            {
                                LogDebug($"Found GetPreviewBitmap on {iface.Name}");
                                previewMethod = method;
                                targetInterface = iface;
                                break;
                            }
                        }
                    }
                    
                    if (previewMethod != null)
                    {
                        LogDebug("Calling GetPreviewBitmap via interface...");
                        try
                        {
                            object[] args = new object[] { 0 };
                            previewBitmap = previewMethod.Invoke(doc, args);
                            previewError = Convert.ToInt32(args[0]);
                            
                            LogDebug($"GetPreviewBitmap result: {(previewBitmap != null ? previewBitmap.GetType().Name : "null")}, error={previewError}");
                        }
                        catch (Exception bmpEx)
                        {
                            var inner = (bmpEx as TargetInvocationException)?.InnerException ?? bmpEx;
                            LogDebug($"GetPreviewBitmap failed: {inner.GetType().Name}: {inner.Message}");
                            
                            if (inner is System.Runtime.InteropServices.COMException comEx)
                            {
                                LogDebug($"COM Error: 0x{comEx.ErrorCode:X8}");
                            }
                        }
                    }
                    else
                    {
                        // GetPreviewBitmap not found - try GetEDrawingsData which may contain preview
                        LogDebug("GetPreviewBitmap not found. Trying GetEDrawingsData...");
                        
                        var eDrawingsMethod = interfaces
                            .Where(i => i.Name.StartsWith("ISwDMDocument") || i.Name.StartsWith("SwDMDocument"))
                            .SelectMany(i => i.GetMethods())
                            .FirstOrDefault(m => m.Name == "GetEDrawingsData");
                        
                        if (eDrawingsMethod != null)
                        {
                            LogDebug("Found GetEDrawingsData method");
                            try
                            {
                                // GetEDrawingsData returns byte array of eDrawings format data
                                var eDrawingsData = eDrawingsMethod.Invoke(doc, null);
                                if (eDrawingsData is byte[] edData && edData.Length > 0)
                                {
                                    LogDebug($"Got eDrawings data: {edData.Length} bytes");
                                    // eDrawings data is not directly usable as an image
                                    // But we can try to extract preview from the document using COM
                                }
                            }
                            catch (Exception edEx)
                            {
                                LogDebug($"GetEDrawingsData failed: {edEx.Message}");
                            }
                        }
                        
                        // Try using the full SolidWorks API instead via SolidWorks application
                        // since Document Manager doesn't have preview methods in this version
                        LogDebug("Document Manager doesn't support GetPreviewBitmap.");
                        LogDebug("The interop assembly may be outdated. Available interfaces:");
                        foreach (var iface in interfaces)
                        {
                            LogDebug($"  - {iface.FullName}");
                        }
                        
                        // Check if we have access to newer interface versions in the assembly
                        if (_dmAssembly != null)
                        {
                            var allTypes = _dmAssembly.GetTypes();
                            var docInterfaces = allTypes.Where(t => t.Name.StartsWith("ISwDMDocument") && t.IsInterface).ToList();
                            LogDebug($"Available ISwDMDocument interfaces in assembly ({docInterfaces.Count}):");
                            foreach (var docIface in docInterfaces.OrderBy(t => t.Name).Take(5))
                            {
                                var hasPreview = docIface.GetMethod("GetPreviewBitmap") != null;
                                LogDebug($"  - {docIface.Name} (HasGetPreviewBitmap: {hasPreview})");
                            }
                            
                            // Get the SwDmPreviewError enum type
                            var previewErrorType = GetDmType("SwDmPreviewError");
                            LogDebug($"SwDmPreviewError type: {(previewErrorType != null ? previewErrorType.FullName : "NOT FOUND")}");
                            
                            // Try to cast doc to a versioned interface
                            foreach (var docIface in docInterfaces.OrderByDescending(t => t.Name))
                            {
                                var previewMeth = docIface.GetMethod("GetPreviewBitmap");
                                if (previewMeth != null)
                                {
                                    LogDebug($"Trying to use {docIface.Name}.GetPreviewBitmap...");
                                    try
                                    {
                                        // Create the enum value properly
                                        object errorArg;
                                        if (previewErrorType != null)
                                        {
                                            errorArg = Enum.ToObject(previewErrorType, 0); // swDmPreviewErrorNone = 0
                                        }
                                        else
                                        {
                                            errorArg = 0;
                                        }
                                        
                                        object[] args = new object[] { errorArg };
                                        previewBitmap = previewMeth.Invoke(doc, args);
                                        
                                        // Get the error value back
                                        if (args[0] != null)
                                        {
                                            previewError = Convert.ToInt32(args[0]);
                                        }
                                        
                                        LogDebug($"GetPreviewBitmap result: type={previewBitmap?.GetType().Name ?? "null"}, error={previewError}");
                                        
                                        if (previewBitmap != null)
                                        {
                                            LogDebug($"SUCCESS! Got preview via {docIface.Name}");
                                            break;
                                        }
                                    }
                                    catch (TargetInvocationException tie)
                                    {
                                        var inner = tie.InnerException ?? tie;
                                        LogDebug($"Failed (inner): {inner.GetType().Name}: {inner.Message}");
                                        if (inner is System.Runtime.InteropServices.COMException comEx)
                                        {
                                            LogDebug($"COM Error: 0x{comEx.ErrorCode:X8}");
                                        }
                                    }
                                    catch (Exception castEx)
                                    {
                                        LogDebug($"Failed: {castEx.Message}");
                                    }
                                }
                            }
                        }
                    }
                    
                    if (previewError != 0 || previewBitmap == null)
                    {
                        var errorMsg = previewError switch
                        {
                            0 => "No preview data returned",
                            1 => "No preview saved in file",
                            2 => "Preview is out of date", 
                            3 => "Preview not supported for this file type",
                            -1 => "Method not found on document interface",
                            _ => $"Preview error code: {previewError}"
                        };
                        LogDebug($"Preview failed: {errorMsg}");
                        return new CommandResult { Success = false, Error = errorMsg };
                    }
                }

                // The preview bitmap is a byte array containing DIB data
                LogDebug($"Preview bitmap type: {previewBitmap?.GetType().Name ?? "null"}");
                if (previewBitmap is byte[] dibData && dibData.Length > 0)
                {
                    LogDebug($"DIB data length: {dibData.Length} bytes");
                    var bmpData = ConvertDibToBmp(dibData);
                    if (bmpData == null || bmpData.Length == 0)
                    {
                        LogDebug("Failed to convert DIB to BMP");
                        return new CommandResult { Success = false, Error = "Failed to convert preview image" };
                    }

                    var base64 = Convert.ToBase64String(bmpData);
                    LogDebug($"Preview extracted successfully: {bmpData.Length} bytes");

                    return new CommandResult
                    {
                        Success = true,
                        Data = new
                        {
                            filePath,
                            configuration = configuration ?? "default",
                            imageData = base64,
                            mimeType = "image/bmp",
                            sizeBytes = bmpData.Length
                        }
                    };
                }

                LogDebug($"Preview data not in expected format: {previewBitmap?.GetType().Name ?? "null"}");
                return new CommandResult { Success = false, Error = "Preview data is not in expected format" };
            }
            catch (Exception ex)
            {
                LogDebug($"GetPreviewImage exception: {ex.Message}");
                return new CommandResult { Success = false, Error = ex.Message, ErrorDetails = ex.ToString() };
            }
            finally
            {
                // ALWAYS close the document to release file locks
                if (doc != null)
                {
                    try { ((dynamic)doc).CloseDoc(); } catch { }
                }
            }
        }

        /// <summary>
        /// Convert a DIB (Device Independent Bitmap) byte array to BMP file format.
        /// DIB is the raw bitmap data without the file header; BMP adds the "BM" file header.
        /// </summary>
        private static byte[]? ConvertDibToBmp(byte[] dibData)
        {
            try
            {
                using (var ms = new MemoryStream())
                {
                    // BMP file header (14 bytes)
                    var fileSize = 14 + dibData.Length;
                    ms.Write(new byte[] { 0x42, 0x4D }, 0, 2);  // "BM" signature
                    ms.Write(BitConverter.GetBytes(fileSize), 0, 4);  // File size
                    ms.Write(new byte[] { 0, 0, 0, 0 }, 0, 4);  // Reserved
                    
                    // Calculate offset to pixel data
                    var headerSize = BitConverter.ToInt32(dibData, 0);
                    var pixelOffset = 14 + headerSize;
                    
                    // Check for color table
                    var bitCount = BitConverter.ToInt16(dibData, 14);
                    if (bitCount <= 8)
                    {
                        var colorTableSize = (1 << bitCount) * 4;
                        pixelOffset += colorTableSize;
                    }
                    
                    ms.Write(BitConverter.GetBytes(pixelOffset), 0, 4);
                    ms.Write(dibData, 0, dibData.Length);
                    
                    return ms.ToArray();
                }
            }
            catch
            {
                return null;
            }
        }

        #endregion

        #region Helpers

        private static string? GetDictValue(Dictionary<string, string> dict, string key)
        {
            if (dict.TryGetValue(key, out var value))
                return value;
            return null;
        }

        private static string GetPartNumber(Dictionary<string, string> props)
        {
            string[] partNumberKeys = {
                "Base Item Number",  // SolidWorks Document Manager standard property
                "PartNumber", "Part Number", "Part No", "Part No.", "PartNo",
                "ItemNumber", "Item Number", "Item No", "Item No.", "ItemNo",
                "PN", "P/N", "Number", "No", "No."
            };

            foreach (var key in partNumberKeys)
            {
                var value = GetDictValue(props, key);
                if (value != null && value.Length > 0)
                    return value;
            }

            foreach (var kvp in props)
            {
                var lowerKey = kvp.Key.ToLowerInvariant();
                if (lowerKey.Contains("part") && (lowerKey.Contains("number") || lowerKey.Contains("no")) ||
                    lowerKey.Contains("item") && (lowerKey.Contains("number") || lowerKey.Contains("no")) ||
                    lowerKey == "pn" || lowerKey == "p/n")
                {
                    if (!string.IsNullOrEmpty(kvp.Value))
                        return kvp.Value;
                }
            }

            return "";
        }

        private static string GetRevision(Dictionary<string, string> props)
        {
            string[] revisionKeys = {
                "Revision", "Rev", "Rev.", "REV", "RevLevel", "Rev Level",
                "Revision Level", "RevisionLevel", "ECO", "ECN", "Change Level"
            };

            foreach (var key in revisionKeys)
            {
                var value = GetDictValue(props, key);
                if (value != null && value.Length > 0)
                    return value;
            }

            foreach (var kvp in props)
            {
                var lowerKey = kvp.Key.ToLowerInvariant();
                if (lowerKey.Contains("rev") || lowerKey.Contains("eco") || lowerKey.Contains("ecn"))
                {
                    if (!string.IsNullOrEmpty(kvp.Value))
                        return kvp.Value;
                }
            }

            return "";
        }

        #endregion

        #region IDisposable

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _dmApp = null;
            _dmAssembly = null;
            GC.Collect();
        }

        #endregion
    }
}
