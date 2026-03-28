import { Canvas } from '@react-three/fiber'

export function Viewport() {
  return (
    <Canvas
      flat
      gl={{ antialias: false, alpha: false }}
      camera={{ position: [0, 0, 5], fov: 50 }}
      style={{ background: '#18181b' }}
    >
      {/* Shapes from parsed program will render here */}
    </Canvas>
  )
}
