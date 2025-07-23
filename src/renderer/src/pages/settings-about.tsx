import { Button } from "@renderer/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Control, ControlGroup } from "@renderer/components/ui/control"

export function Component() {
  return (
    <div className="space-y-6">
      {/* App Info */}
      <Card variant="apple-2025" className="p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">
            {process.env.PRODUCT_NAME} {process.env.APP_VERSION}
          </h1>
          <p className="text-muted-foreground">
            Enhanced with Apple 2025 Liquid Glass Effects
          </p>
        </div>
      </Card>

      {/* Apple 2025 Liquid Glass Showcase */}
      <ControlGroup title="Apple 2025 Liquid Glass Effects" variant="glass">
        <Control label="Interactive Glass" variant="apple-interactive">
          <Button variant="apple-2025" size="sm">
            Hover Me
          </Button>
        </Control>

        <Control label="Floating Glass" variant="default">
          <Button variant="apple-floating" size="sm">
            Floating
          </Button>
        </Control>

        <Control label="Ripple Glass" variant="default">
          <Button variant="apple-ripple" size="sm">
            Click Me
          </Button>
        </Control>
      </ControlGroup>

      {/* Glass Card Variants */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card variant="apple-2025">
          <CardHeader>
            <CardTitle>Apple 2025 Glass</CardTitle>
            <CardDescription>
              Enhanced backdrop-filter with brightness and contrast adjustments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Features multi-layer pseudo-elements for depth and realistic light refraction.
            </p>
          </CardContent>
        </Card>

        <Card variant="apple-floating">
          <CardHeader>
            <CardTitle>Floating Glass</CardTitle>
            <CardDescription>
              Animated floating effect with enhanced blur
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Subtle animation creates a dynamic, immersive glass experience.
            </p>
          </CardContent>
        </Card>

        <Card variant="apple-interactive">
          <CardHeader>
            <CardTitle>Interactive Glass</CardTitle>
            <CardDescription>
              Responsive glass with hover animations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Includes shine effects and interactive state changes on hover.
            </p>
          </CardContent>
        </Card>

        <Card variant="glass-strong">
          <CardHeader>
            <CardTitle>Enhanced Traditional</CardTitle>
            <CardDescription>
              Improved version of the original glass effect
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Updated with Apple 2025 techniques while maintaining compatibility.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Technical Details */}
      <Card variant="apple-2025" className="p-6">
        <h3 className="text-lg font-semibold mb-4">Apple 2025 Enhancements</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Backdrop Filter:</span>
            <span>blur() + saturate() + brightness() + contrast()</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Layering:</span>
            <span>Multi-layer pseudo-elements with gradients</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Animations:</span>
            <span>Smooth transitions with cubic-bezier easing</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">SVG Displacement:</span>
            <span>Advanced fractal noise for organic distortion</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Browser Support:</span>
            <span>Progressive enhancement with fallbacks</span>
          </div>
        </div>
      </Card>
    </div>
  )
}
