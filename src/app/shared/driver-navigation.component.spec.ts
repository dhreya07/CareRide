import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DriverNavigationComponent } from './driver-navigation.component';

describe('Driver navigation', () => {
  it('renders exactly five primary tabs with the existing active trip route', () => {
    TestBed.configureTestingModule({
      imports: [DriverNavigationComponent],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(DriverNavigationComponent);
    fixture.detectChanges();
    const navigation: HTMLElement = fixture.nativeElement;
    const links = Array.from(navigation.querySelectorAll('nav a'));
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Home', 'Schedule', 'Active Client', 'History', 'Profile',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/driver', '/driver/schedule', '/driver/active', '/driver/history', '/driver/profile',
    ]);
  });
});
