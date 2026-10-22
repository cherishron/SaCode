# Basic Components

This section covers the fundamental UI components provided by Kuikly framework.

## Overview

Basic components include essential building blocks for creating user interfaces such as Text, View, Button, and other core elements.

## Available Components

- **Text**: Display text content with various styling options
- **View**: Container component for layout purposes
- **Button**: Interactive button component for user actions
- **Image**: Display image content from various sources

## Usage Examples

```kotlin
// Example basic component usage
Text {
    attr { text("Hello World") }
}

Button {
    attr { size(200f, 44f) }
    titleAttr { text("Click Me") }
    event { click {} }
}
```

## Related Documentation

- [API Reference](https://kuikly.tds.qq.com/API/components/basic/)
- [Getting Started Guide](../getting-started.md)