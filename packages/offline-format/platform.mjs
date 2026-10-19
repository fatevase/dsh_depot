export const TARGETS = ['macos-arm64','linux-x64','win32-x64']
export const supportedTarget = target => TARGETS.includes(target)
// Node.js names the macOS operating system "darwin"; product targets use "macos".
export const runtimeTarget = (platform,arch) => `${platform==='darwin'?'macos':platform}-${arch}`
