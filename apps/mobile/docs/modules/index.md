# Module System

This section covers Kuikly's module system for extending functionality and integrating with native platform features.

## Overview

Modules provide access to platform-specific capabilities and extend the framework's functionality beyond basic UI components.

## Available Modules

- **NetworkModule**: HTTP client and networking
- **StorageModule**: Local data persistence
- **CameraModule**: Camera and media capture
- **LocationModule**: GPS and location services
- **NotificationModule**: Push notifications
- **RouterModule**: Navigation and routing

## Module Usage

```kotlin
// Example module usage
val network = getModule<NetworkModule>()
network.get("https://api.example.com/data") { response ->
    // Handle response
}
```

## Module Types

- **System Modules**: Built-in framework modules
- **Custom Modules**: User-defined extensions
- **Platform Modules**: Native platform integrations

## Related Documentation

- [Module Development Guide](../module-development.md)
- [Native Integration](../native-integration.md)