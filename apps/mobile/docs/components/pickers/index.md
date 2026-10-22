# Picker Components

This section covers selection and picker components for user input and data selection.

## Overview

Picker components enable users to select values from predefined options or ranges.

## Available Components

- **DatePicker**: Select date values
- **TimePicker**: Select time values
- **DropdownPicker**: Dropdown selection component
- **SegmentedPicker**: Segmented control selection
- **WheelPicker**: Wheel-style selection

## Usage Examples

```kotlin
// Example picker usage
DatePicker {
    attr { date(System.currentTimeMillis()) }
    event { dateSelected { date -> /* handle date */ } }
}
```

## Common Properties

- `selectedValue()` - Currently selected value
- `options()` - Available selection options
- `onSelectionChange()` - Selection change callback

## Related Documentation

- [Form Components](../forms/)
- [Input Handling Guide](../input-handling.md)