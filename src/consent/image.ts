/**
 * Accepts only real JPEG/PNG bytes (magic numbers), whatever the Content-Type
 * says. With the Fake provider, a `FAKE:` scenario header is accepted too so
 * the flow can be exercised without real photos.
 */
export function isSupportedImage(image: Buffer, allowFake: boolean): boolean {
  if (image.length < 4) return false;
  const jpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const png =
    image[0] === 0x89 &&
    image[1] === 0x50 &&
    image[2] === 0x4e &&
    image[3] === 0x47;
  const fake = allowFake && image.subarray(0, 5).toString('utf8') === 'FAKE:';
  return jpeg || png || fake;
}
