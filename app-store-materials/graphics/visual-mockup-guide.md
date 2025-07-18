# SpeakMCP Visual Mockup Guide

## Design System

### Brand Colors
- **Primary Blue**: #3B82F6 (RGB: 59, 130, 246)
- **Secondary Blue**: #1E40AF (RGB: 30, 64, 175)
- **Accent Green**: #10B981 (RGB: 16, 185, 129)
- **Warning Orange**: #F59E0B (RGB: 245, 158, 11)
- **Error Red**: #EF4444 (RGB: 239, 68, 68)
- **Text Dark**: #1F2937 (RGB: 31, 41, 55)
- **Text Light**: #6B7280 (RGB: 107, 114, 128)
- **Background Light**: #F9FAFB (RGB: 249, 250, 251)
- **Background Dark**: #111827 (RGB: 17, 24, 39)

### Typography
- **Primary Font**: SF Pro Display (macOS system font)
- **Monospace**: SF Mono (for code/technical content)
- **Sizes**: 
  - Headline: 28px, Bold
  - Title: 20px, Semibold
  - Body: 14px, Regular
  - Caption: 12px, Regular

### Layout Grid
- **Container Width**: 1280px (for 1280x800 screenshots)
- **Margins**: 24px on all sides
- **Column Grid**: 12 columns with 20px gutters
- **Vertical Rhythm**: 8px baseline grid

## Screenshot Mockups

### Mockup 1: Main Interface - Recording History
**Dimensions**: 1280x800px
**Layout**: Full application window

#### Window Structure
```
┌─────────────────────────────────────────────────────────────┐
│ ● ● ●                    SpeakMCP                          │ ← Title bar (28px)
├─────────────────────────────────────────────────────────────┤
│ History    │                                               │
│            │  ┌─────────────────────────────────────────┐  │
│ Settings   │  │ Search recordings...              🔍   │  │ ← Header (48px)
│            │  └─────────────────────────────────────────┘  │
│            │                                               │
│            │  Today                                        │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ 10:30 AM  Let me draft a quick email... │  │
│            │  │           ▶ 🗑                          │  │
│            │  └─────────────────────────────────────────┘  │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ 9:45 AM   Take note: Research competitor │  │
│            │  │           ▶ 🗑                          │  │
│            │  └─────────────────────────────────────────┘  │
│            │                                               │
│            │  Yesterday                                    │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ 4:20 PM   Meeting notes: Client wants... │  │
│            │  │           ▶ 🗑                          │  │
│            │  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

#### Content Details
- **Sidebar**: 144px wide, dark background
- **Main Area**: Remaining width, light background
- **Search Bar**: Full width with icon
- **Recording Cards**: 
  - Height: 64px each
  - Padding: 16px
  - Border radius: 8px
  - Shadow: subtle drop shadow
- **Time Stamps**: 
  - Width: 60px
  - Background: light gray pill
  - Font: 12px monospace

### Mockup 2: Recording Panel - Real-Time Visualization
**Dimensions**: 400x80px (floating panel)
**Layout**: Compact recording interface

#### Panel Structure
```
┌──────────────────────────────────────────────────────────────┐
│ ● │ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌ │
└──────────────────────────────────────────────────────────────┘
```

#### Visual Elements
- **MCP Indicator**: Blue dot (8px) on left
- **Audio Bars**: 
  - Width: 2px each
  - Gap: 2px between bars
  - Height: Variable (16px to 48px)
  - Color: Red (#EF4444) when active
  - Color: Gray (#9CA3AF) when inactive
- **Background**: Semi-transparent dark
- **Border Radius**: 12px

### Mockup 3: Settings - AI Provider Configuration
**Dimensions**: 1280x800px
**Layout**: Settings window with sidebar

#### Settings Structure
```
┌─────────────────────────────────────────────────────────────┐
│ ● ● ●                    Settings                          │
├─────────────────────────────────────────────────────────────┤
│ General    │  Providers                                    │
│            │                                               │
│ Providers  │  Speech-to-Text                              │
│            │  ┌─────────────────────────────────────────┐  │
│ Data       │  │ ✓ Groq (Whisper-large-v3)              │  │
│            │  │ ○ OpenAI (Whisper-1)                   │  │
│ About      │  │ ○ Local (Lightning Whisper MLX)        │  │
│            │  └─────────────────────────────────────────┘  │
│            │                                               │
│            │  Post-Processing                              │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ ✓ Groq (llama-3.1-70b-versatile)       │  │
│            │  │ ○ OpenAI (gpt-4)                       │  │
│            │  │ ○ Gemini (gemini-pro)                  │  │
│            │  └─────────────────────────────────────────┘  │
│            │                                               │
│            │  Custom Prompt                                │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ Improve grammar and punctuation while   │  │
│            │  │ maintaining the original tone...        │  │
│            │  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Mockup 4: MCP Tools Integration
**Dimensions**: 1280x800px
**Layout**: Tools configuration panel

#### Tools Interface
```
┌─────────────────────────────────────────────────────────────┐
│ ● ● ●                  MCP Tools                           │
├─────────────────────────────────────────────────────────────┤
│            │  Available Tools                              │
│            │                                               │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ ✓ File Manager                          │  │
│            │  │   Create, read, and organize files      │  │
│            │  └─────────────────────────────────────────┘  │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ ✓ Email Client                          │  │
│            │  │   Compose and send emails               │  │
│            │  └─────────────────────────────────────────┘  │
│            │                                               │
│            │  Recent Tool Calls                            │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ "Create a new project folder..."        │  │
│            │  │ → File Manager: Created successfully    │  │
│            │  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Mockup 5: Accessibility Features
**Dimensions**: 1280x800px
**Layout**: Accessibility settings

#### Accessibility Interface
```
┌─────────────────────────────────────────────────────────────┐
│ ● ● ●                Accessibility                         │
├─────────────────────────────────────────────────────────────┤
│            │  Accessibility Features                       │
│            │                                               │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ ✓ Voice Control                         │  │
│            │  │   Complete hands-free operation         │  │
│            │  └─────────────────────────────────────────┘  │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ ✓ Large Text                            │  │
│            │  │   Enhanced readability                  │  │
│            │  └─────────────────────────────────────────┘  │
│            │                                               │
│            │  Keyboard Shortcuts                           │
│            │  ┌─────────────────────────────────────────┐  │
│            │  │ Hold Ctrl      Standard recording       │  │
│            │  │ Ctrl + /       Toggle recording         │  │
│            │  │ Escape         Cancel recording         │  │
│            │  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Asset Creation Guidelines

### Screenshot Preparation
1. **Clean Environment**
   - Fresh macOS installation appearance
   - Default wallpaper or neutral background
   - No personal files or information visible
   - Consistent window positioning

2. **Content Standards**
   - Professional, business-appropriate text
   - Realistic but polished examples
   - No Lorem Ipsum or placeholder text
   - Diverse use case representation

3. **Technical Quality**
   - High resolution (2x for Retina displays)
   - Crisp text and UI elements
   - Consistent lighting and contrast
   - No compression artifacts

### Icon Design
- **Style**: Modern, minimal, professional
- **Colors**: Primary brand colors
- **Symbol**: Microphone or waveform element
- **Background**: Gradient or solid color
- **Format**: PNG with transparency for smaller sizes

### Promotional Graphics
- **Hero Images**: Feature callouts with screenshots
- **Comparison Charts**: vs. competitors
- **Feature Highlights**: Individual capability showcases
- **Workflow Diagrams**: User journey illustrations

## File Organization

### Directory Structure
```
graphics/
├── screenshots/
│   ├── 1280x800/
│   ├── 1440x900/
│   ├── 2560x1600/
│   └── 2880x1800/
├── icons/
│   ├── app-icon-1024.png
│   ├── app-icon-512.png
│   └── [other sizes]
├── promotional/
│   ├── hero-image.png
│   ├── feature-callouts/
│   └── social-media/
└── source-files/
    ├── sketch/
    ├── figma/
    └── photoshop/
```

### Naming Convention
- Screenshots: `screenshot-[number]-[description]-[size].png`
- Icons: `app-icon-[size].png`
- Promotional: `promo-[type]-[description].png`

### Quality Checklist
- [ ] All text is readable at intended size
- [ ] Colors match brand guidelines
- [ ] No spelling or grammar errors
- [ ] Consistent visual style across all assets
- [ ] Proper file formats and compression
- [ ] Multiple resolutions provided
- [ ] Source files backed up and organized
