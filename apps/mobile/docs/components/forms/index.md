# Form Components

This section covers form and input components for user data entry and validation.

## Overview

Form components provide structured input controls with validation, formatting, and submission capabilities.

## Available Components

- **TextInput**: Single-line text input
- **TextArea**: Multi-line text input
- **Checkbox**: Boolean selection control
- **RadioGroup**: Single selection from multiple options
- **Switch**: Toggle switch control
- **Slider**: Range value selection

## Usage Examples

```kotlin
// Example form usage
TextInput {
    attr {
        hint("Enter your name")
        maxLength(50)
    }
    event { textChange { text -> /* handle change */ } }
}
```

## Form Features

- **Validation**: Built-in validation rules
- **Formatting**: Input formatters and masks
- **Keyboard Types**: Optimized keyboard types
- **Accessibility**: Screen reader support

## Related Documentation

- [Form Validation](../form-validation.md)
- [Input Handling Guide](../input-handling.md)