import { describe, it, expect } from 'vitest';
import { getJulianDate, getLocalSiderealTime, equatorialToHorizontal, horizonToCartesian } from '../calculations';

describe('Calculations module tests', () => {
  it('should calculate Julian Date correctly', () => {
    // 2000-01-01 12:00 UTC は JD = 2451545.0
    const d = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
    const jd = getJulianDate(d);
    expect(jd).toBeCloseTo(2451545.0, 5);
  });

  it('should calculate Local Sidereal Time correctly', () => {
    const jd = 2451545.0;
    const lst = getLocalSiderealTime(jd, 0.0);
    // 概ね 280.46061837 度付近
    expect(lst).toBeCloseTo(280.4606, 1);
  });

  it('should convert equatorial to horizontal correctly', () => {
    // 天頂方向の検証: RA=0, Dec=0, LST=0, Lat=0
    const hor = equatorialToHorizontal(0, 0, 0, 0);
    expect(hor.alt).toBeCloseTo(90.0, 5);
  });

  it('should project horizon coordinates to cartesian Vector3 correctly', () => {
    const r = 100;
    const pos = horizonToCartesian(0, 90, r); // 天頂 Alt=90
    expect(pos.x).toBeCloseTo(0, 5);
    expect(pos.y).toBeCloseTo(r, 5);
    expect(pos.z).toBeCloseTo(0, 5);
  });
});
