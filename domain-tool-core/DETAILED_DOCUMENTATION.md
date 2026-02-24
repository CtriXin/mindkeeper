# Domain Tool Core Documentation

## Overview
The Domain Tool Core is a centralized engine (Mother Core) that converts Excel spreadsheets into domain configuration JSON files. It handles ad placement mappings and provides a unified approach to configuration management across multiple projects.

## Purpose
- Convert Excel-based domain configuration data to JSON format
- Map Excel columns to specific configuration fields using smart matching
- Handle advertising configuration including array-type ad placements
- Generate approval reports for domain configuration changes

## Key Features

### 1. Excel Parsing
- Automatically identifies and parses Excel files (.xlsx) in the input directory
- Smart column matching using alias database for common field names
- Handles multiple sheets and complex Excel structures

### 2. Smart Field Mapping
- Uses alias database to match Excel columns to configuration keys
- Supports nested properties (e.g., meta.title, meta.description)
- Provides automatic suggestions for configuration mappings

### 3. Advertising Configuration
- Supports ad mapping with placeholder syntax: `'output_key': '${excel_column}'`
- Handles both single-value and array-type ad placements
- Supports multiple ad platforms (adsense, adx, etc.)

### 4. Template Generation
- Creates `suggested-config.js` with appropriate mapping templates
- Provides intelligent suggestions based on existing data
- Supports array-type ad slot generation

### 5. Preview Mode
- Allows safe testing with `--preview` flag
- Generates `preview-output.json` without modifying production files
- Helps validate configuration before actual generation

### 6. Approval Reports
- Automatically generates approval reports for domain changes
- Outputs formatted lists for administrative approval

## Configuration Syntax

### New Placeholder Syntax (Required since v2.7.0+)
```javascript
adsMapping: {
  adsense: {
    'home_1': '${home_1}',     // New syntax: 'output_key': '${excel_column}'
    'list_top': '${list_1}'    // Left: output key, Right: Excel column name
  },
  adx: {
    'list_top': '${list_1}',
    'categories[0]': '${list_2}',    // Array element support
    'categories[1]': '${list_3}'     // Array element support
  }
}
```

### Mapping Configuration
```javascript
module.exports = {
  paths: {
    inputDir: './input',           // Directory containing Excel files
    output: './output.json'       // Output configuration file path
  },
  sheets: {
    domain: ['域名配置']           // Sheet names for domain data
  },
  mapping: {
    '_key': 'domain',            // Maps Excel column to configuration key
    'siteName': 'siteName',
    'IAMEMAIL': 'contactEmail',
    'ABOUTUS': 'aboutContent',
    'meta.title': 'pageTitle',
    'meta.des': 'pageDescription',
    '_ads_content': 'ads_txt_content',
    '_ads_group': 'ads_group_id',
    '_adsense_script': 'verification_script'
  },
  adsMapping: {
    adsense: {
      'home_1': '${home_ad_unit_1}',
      'list_top': '${list_top_ad_unit}',
      'categories[0]': '${category_ad_1}',
      'categories[1]': '${category_ad_2}'
    }
  }
};
```

## Global Anchor System

The Domain Tool Core uses a global anchor system to allow cross-project access:

1. Creates anchor file at `~/.domain-tool-core-anchor`
2. Contains absolute path to the core directory
3. Sub-projects read core path from this anchor file
4. Allows moving the core directory without breaking references

To update the anchor after moving the directory:
```bash
cd /path/to/domain-tool-core
node install.js
```

## Usage

### Basic Execution
```bash
node index.js
```

### Command Line Arguments
- `--preview`: Generate preview output without modifying files
- `--adsOnly`: Generate only advertising configuration
- `--domains`: Specify target domains to process
- `--input`: Specify input Excel file
- `--output`: Specify output configuration file
- `--merge=false`: Disable merging with existing configuration
- `--adsTemplate`: Use custom ads template

### Interactive Flow
1. Choose to generate `suggested-config.js` (configuration reference assistant)
2. If yes, the tool analyzes existing data and creates mapping suggestions
3. If no, proceed directly to configuration generation
4. Parse Excel file and apply mappings from config.js
5. Generate final configuration output

### Suggested Config Generation
When you choose to generate suggestions, the tool:
1. Reads an existing configuration to understand the structure
2. Analyzes Excel column headers
3. Creates `suggested-config.js` with appropriate mapping suggestions
4. Provides comments to guide manual configuration

## Security Considerations

### File Permissions
- Input/output files use standard file permissions
- No sensitive data is stored in plain text
- Temporary files are cleaned up appropriately

### Data Handling
- Excel files are processed locally
- No external data transmission occurs during normal operations
- Generated configurations contain only provided data

## Common Use Cases

### 1. New Domain Setup
- Prepare Excel with domain information
- Run tool to generate initial configuration
- Use suggested-config.js to refine mappings
- Deploy resulting JSON configuration

### 2. Advertising Configuration Updates
- Update Excel with new ad placements
- Use array notation for multiple ad units
- Preview changes before applying
- Deploy updated configuration

### 3. Bulk Domain Configuration
- Include multiple domains in single Excel file
- Use template to ensure consistent structure
- Generate comprehensive configuration set
- Validate with preview mode

## Error Handling

### Common Errors
- **"未能找到 Excel 文件"**: No Excel file found in input directory
- **"未找到 Mother Core 锚点"**: Anchor file not found, run `node install.js`
- **Column mapping errors**: Excel columns don't match expected names

### Recovery Procedures
1. Verify Excel file exists in input directory
2. Ensure domain-tool-core anchor is properly set
3. Check column names match mapping expectations
4. Use `--preview` mode to validate before production runs

## Integration Points

### With SCMP Tools
- Generated configurations can be deployed via SCMP
- Supports automated deployment workflows
- Integrates with service configuration systems

### With Git Workflows
- Compatible with push/pull operations
- Supports pre/post hook integration
- Works with version control systems

## Maintenance

### Updating Core Location
When moving the domain-tool-core directory:
1. Move the entire directory
2. Navigate to the new location
3. Run `node install.js` to update the anchor file

### Version Compatibility
- v2.7.0+ requires new placeholder syntax (`'${column}'`)
- Old syntax (`'column'`) is no longer supported
- Use suggested-config.js generator to migrate existing configurations

## Troubleshooting

### Issues with Column Matching
- Verify Excel column headers match expected names
- Check for typos in column names
- Use alias database entries if available
- Consider using `suggested-config.js` generator

### Problems with Ad Placements
- Ensure array-type ads use correct bracket notation
- Verify Excel contains sufficient columns for all ad placements
- Use placeholder syntax (`'${column}'`) for all mappings

### Permission Issues
- Verify read/write access to input/output directories
- Check file permissions for Excel and output files
- Ensure anchor file has appropriate permissions

## Performance Tips

### Large Excel Files
- Split very large Excel files into smaller chunks
- Process subsets of domains when possible
- Use preview mode before full generation

### Efficient Mapping
- Reuse existing configuration templates
- Standardize Excel column naming conventions
- Use suggested-config.js generator for consistency