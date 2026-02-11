import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';

interface WebQRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

/**
 * Web-only QR code scanner using html5-qrcode library.
 * Only renders on web platform, returns null on native.
 */
export function WebQRScanner({ onScan, onClose }: WebQRScannerProps) {
  const scannerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let html5QrCode: any = null;
    let mounted = true;

    const initScanner = async () => {
      try {
        // Dynamic import for web only
        const { Html5Qrcode } = await import('html5-qrcode');
        
        if (!mounted) return;

        html5QrCode = new Html5Qrcode('web-qr-reader');
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText: string) => {
            // Success callback
            html5QrCode.stop().catch(console.error);
            onScan(decodedText);
          },
          () => {
            // Error callback (QR not found in frame) - ignore
          }
        );

        if (mounted) {
          setIsStarting(false);
        }
      } catch (err: any) {
        console.error('[WebQRScanner] Error:', err);
        if (mounted) {
          setIsStarting(false);
          if (err?.message?.includes('Permission denied') || err?.name === 'NotAllowedError') {
            setError('Camera permission denied. Please allow camera access and try again.');
          } else if (err?.message?.includes('not found') || err?.name === 'NotFoundError') {
            setError('No camera found. Please connect a camera and try again.');
          } else {
            setError(err?.message || 'Failed to start camera');
          }
        }
      }
    };

    initScanner();

    return () => {
      mounted = false;
      if (html5QrCode) {
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [onScan]);

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📷 Scan QR Code</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.scannerWrapper}>
        {isStarting && !error && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.loadingText}>Starting camera...</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={onClose} style={styles.retryButton}>
              <Text style={styles.retryText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}
        <div 
          id="web-qr-reader" 
          style={{ width: '100%', maxWidth: 400 }}
          ref={containerRef as any}
        />
      </View>

      <Text style={styles.hint}>
        Point your camera at an ACP Remote QR code
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: 10,
  },
  closeText: {
    color: '#fff',
    fontSize: 24,
  },
  scannerWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
  },
  errorContainer: {
    position: 'absolute',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
  },
  hint: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
});

export default WebQRScanner;

