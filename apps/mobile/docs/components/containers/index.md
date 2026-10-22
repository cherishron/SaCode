# Container Components

This section covers layout and container components that help organize other UI elements.

## Overview

Container components provide structured layouts and organizational capabilities for building complex user interfaces.

## Available Components

- **Column**: Vertical layout container
- **Row**: Horizontal layout container
- **Stack**: Overlapping layout container
- **Scroller**: Scrollable content container
- **FlexBox**: Flexible box layout system

## Usage Examples

```kotlin
// Example container usage
Column {
    attr { flexDirectionColumn() }
    Text { attr { text("Item 1") } }
    Text { attr { text("Item 2") } }
}
```

## Layout Properties

- `flexDirection()` - Set main axis direction
- `justifyContent()` - Align items along main axis
- `alignItems()` - Align items along cross axis
- `padding()` - Internal spacing
- `margin()` - External spacing

## Related Documentation

- [Layout Guide](../layout-guide.md)
- [FlexBox System](../flexbox-system.md)