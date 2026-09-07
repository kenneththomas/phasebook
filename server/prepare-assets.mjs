import sharp from 'sharp';
for (let i = 0; i < 9; i++) {
  const name =
    i < 6 ? `avatar-${i + 1}` : ['campus', 'coast', 'weekend'][i - 6];
  await sharp('public/assets/atlas.png')
    .extract({
      left: (i % 3) * 418,
      top: Math.floor(i / 3) * 418,
      width: 418,
      height: 418,
    })
    .jpeg({ quality: 88 })
    .toFile(`public/assets/${name}.jpg`);
}
for (let i = 7; i <= 8; i++)
  await sharp('public/assets/avatar-' + (i - 6) + '.jpg').toFile(
    `public/assets/avatar-${i}.jpg`,
  );
