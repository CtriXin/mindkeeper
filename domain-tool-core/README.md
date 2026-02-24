# Domain Tool Core Documentation

The Domain Tool Core is a centralized engine (Mother Core) that converts Excel spreadsheets into domain configuration JSON files. It handles ad placement mappings and provides a unified approach to configuration management across multiple projects.

## Overview

The Domain Tool Core serves as the central hub for domain configuration generation. It parses Excel files containing domain settings and generates standardized JSON configurations. The system supports advanced features like dynamic ad slot mapping and template-based configuration generation.

## Key Features

### 1. Excel-Based Configuration
- Reads Excel spreadsheets with domain configuration data
- Automatically detects columns and maps them to configuration fields
- Handles various Excel formats and structures

### 2. Advanced Ad Mapping System
- Supports new placeholder syntax: `'output_key': '${excel_column}'`
- Array element mapping: `'categories[0]': '${list_2}'`
- Automatic detection of array-type ad placements

### 3. Template Support
- Custom ad template system for complex configurations
- Separation of ad mapping, field formatting, and outer structure
- Flexible template architecture

## Configuration Syntax (v2.7.0+)

The system uses a new standardized syntax for ad mapping:

```javascript
adsMapping: {
  adsense: {
    // New syntax: 'output_key': '${excel_column}'
    'home_1': '${home_1}',
    'list_top': '${list_1}'
  },
  adx: {
    'list_top': '${list_1}',           // Single object
    'categories[0]': '${list_2}',      // Array element
    'categories[1]': '${list_3}'       // Array element
  }
}
```

**Important:** The old syntax (`'excel_column': 'output_key'`) is no longer supported as of v2.7.0.

## Global Anchor System

To enable cross-project access, the Domain Tool Core uses a global anchor system:

1. The core creates an anchor file at `~/.domain-tool-core-anchor`
2. This file contains the absolute path to the core directory
3. Sub-projects read the core path from this anchor file
4. Moving the core directory requires updating the anchor with `node install.js`

### Installing/Updating the Anchor

When you move or rename the domain-tool-core directory:

```bash
cd /path/to/new/domain-tool-core/location
node install.js
```

This updates the anchor file with the new path, ensuring all sub-projects can continue to access the core.

## Getting Started

### Installation

1. Install dependencies:
```bash
cd domain-tool-core
npm install
```

2. Set up the global anchor:
```bash
node install.js
```

### Basic Usage

1. Prepare your Excel spreadsheet with domain configuration data
2. Create or update your `config.js` file with the proper mapping syntax
3. Run the domain tool to generate configurations

Example basic usage:
```bash
node index.js
```

### Generating Suggested Configuration

To help with mapping, generate a suggested configuration:

```bash
node index.js
# Select 'y' when prompted to generate suggested-config.js
```

This creates a `suggested-config.js` file with proper syntax and mappings based on your Excel data.

## Advanced Features

### Ads Template System

The tool supports custom ads templates for complex ad placement structures:

1. Create an `ads-template.js` file in your project
2. Define the template structure
3. The template system takes precedence over standard adsMapping

Example template:
```javascript
module.exports = {
  // Define custom ad structure template
  adUnit: {
    type: 'adsense',
    attributes: {
      id: '',
      slot: ''
    }
  }
};
```

### Dynamic Ads Group Resolution

Supports dynamic resolution of ads groups and content placeholders:
- `_ads_group` placeholders for dynamic ad group assignment
- `_ads_content` placeholders for dynamic ad content resolution

### Preview Mode

Always test configurations using preview mode:

```bash
node index.js --preview
```

This generates `preview-output.json` without making actual changes, allowing you to review the output before production deployment.

## Migration Guide (v2.6.0 to v2.7.0+)

With the v2.7.0 update, the configuration syntax changed significantly:

### Old Format (No Longer Supported)
```javascript
adsMapping: {
  adsense: {
    'home_1': 'home_1',        // ❌
    'list_top': 'list_1'       // ❌
  }
}
```

### New Format (Required)
```javascript
adsMapping: {
  adsense: {
    'home_1': '${home_1}',     // ✅
    'list_top': '${list_1}'    // ✅
  }
}
```

### Migration Steps
1. Run your project with the new core version to identify old-format usage
2. The system will show error messages indicating which configurations need updating
3. Update your config.js files to use the new syntax
4. Use the `suggested-config.js` generator to get proper syntax examples

## Common Issues and Solutions

### Issue: "Not found Mother Core Anchor"
**Solution:** Run `node install.js` in the domain-tool-core directory to update the anchor file.

### Issue: Configuration Not Working After Upgrade
**Solution:** Verify you're using the new placeholder syntax (`'${column}'` instead of `'column'`).

### Issue: Array Ads Not Working
**Solution:** Ensure you're using the array syntax: `'categories[0]': '${list_2}'`.

### Issue: Columns Not Mapping Properly
**Solution:**
1. Regenerate suggested-config.js to see current Excel column names
2. Verify column names in Excel match your mapping exactly (case-sensitive)
3. Remember that domain prefixes are automatically stripped from column names

## Debugging Guidelines

### Configuration Not Taking Effect
1. Verify configuration syntax uses new placeholder format
2. Run `node index.js` and select option to regenerate suggested-config.js
3. Compare suggested-config.js with your config.js for differences
4. Use `--preview` mode to see actual output

### Missing Ad Slots
1. Check Excel sheet has corresponding columns
2. Verify column names match your adsMapping definitions
3. Ensure column prefixes are correct (domain prefixes are stripped automatically)
4. Review preview-output.json for actual output

### Incorrect Array Ad Elements
1. Confirm using array syntax: `'categories[0]': '${list_2}'`
2. Verify Excel has sufficient columns for array elements (list_2, list_3, etc.)
3. Check suggested-config.js for correct array length generation

## Performance Improvements in v2.7.0+

- Removed backward compatibility code
- Simplified processing from two-pass to single-pass
- Eliminated `usedSlots` tracking overhead
- Reduced configuration generation speed by ~40%

## Planned Enhancements

### Short-term
- Enhanced configuration validation tool
- Improved error messaging for invalid configurations
- Better integration with IDEs for syntax checking

### Medium-term
- GUI configuration editor
- Configuration template inheritance
- Complex conditional mapping support

### Long-term
- Multiple output format support (JSON, YAML)
- Automatic configuration migration tools

## Support and Maintenance

For issues or enhancements:
1. Consult the MAINTENANCE.md document
2. Check the suggested-config.js generator
3. Review error messages for upgrade guidance
4. Contact the Domain Tool Core maintainers

## Related Projects

This core is designed to work with:
- SCMP Deployment tools
- Various domain configuration projects
- Excel-based configuration workflows
- Multi-domain ad placement systems