type BrandMarkProps = {
  name?: string;
  subtitle?: string;
  logoSrc?: string;
};

export function BrandMark({ name = "Samyak", subtitle = "Student Portal", logoSrc = "/samyak-logo.webp" }: BrandMarkProps) {
  return (
    <div className="brand-mark" aria-label={`${name} ${subtitle}`}>
      <img src={logoSrc} alt="" className="brand-mark__logo" />
      <div>
        <p className="brand-mark__name">{name}</p>
        <p className="brand-mark__sub">{subtitle}</p>
      </div>
    </div>
  );
}
