import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"

export function Component() {
  return (
    <div className="p-6 space-y-6">
      {/* App Info */}
      <Card className="p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">
            {process.env.PRODUCT_NAME} {process.env.APP_VERSION}
          </h1>
          <p className="text-muted-foreground">
            Voice-to-text application with AI processing
          </p>
        </div>
      </Card>

      {/* App Description */}
      <Card>
        <CardHeader>
          <CardTitle>About This Application</CardTitle>
          <CardDescription>
            A modern voice-to-text application built with Electron and React
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This application provides seamless voice recording and transcription capabilities,
            allowing you to convert speech to text with ease. Built with modern web technologies
            for a smooth and responsive user experience.
          </p>
        </CardContent>
      </Card>

      {/* Technical Information */}
      <Card>
        <CardHeader>
          <CardTitle>Technical Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version:</span>
              <span>{process.env.APP_VERSION}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform:</span>
              <span>Electron + React</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Build:</span>
              <span>{process.env.NODE_ENV}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
