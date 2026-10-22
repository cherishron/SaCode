# Effect Components

This section covers visual effect components that enhance UI appearance and user experience.

## Overview

Effect components provide visual enhancements such as shadows, borders, backgrounds, and other styling effects.

## Available Components

- **Shadow**: Drop shadow effects
- **Border**: Border styling components
- **Background**: Background color and image components
- **Gradient**: Gradient background effects
- **Opacity**: Transparency controls

## Usage Examples

```kotlin
// Example effect usage
Text {
    attr {
        text("Styled Text")
        backgroundColor(0xFF2196F3.toLong())
        border(
            Border(
                width = 1f,
                style = BorderStyle.SOLID,
                color = 0xFF000000.toLong()
            )
        )
    }
}
```

## Common Effects

- `shadow()` - Add drop shadow
- `border()` - Apply border styling
- `backgroundColor()` - Set background color
- `opacity()` - Control transparency

## Related Documentation

- [Styling Guide](../styling-guide.md)
- [Visual Design System](../design-system.md)