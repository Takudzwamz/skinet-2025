import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { CurrencyPipe, Location } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { CartService } from '../../../core/services/cart.service';
import { PaystackService } from '../../../core/services/paystack.service'; // Import PaystackService

@Component({
  selector: 'app-order-summary',
  imports: [
    MatFormField, MatLabel, MatButton, RouterLink, MatInput, CurrencyPipe, FormsModule, MatIcon
  ],
  templateUrl: './order-summary.component.html',
  styleUrl: './order-summary.component.scss'
})
export class OrderSummaryComponent {
  cartService = inject(CartService);
  private paystackService = inject(PaystackService); // Inject PaystackService
  location = inject(Location);
  code?: string;

  applyCouponCode() {
    if (!this.code) return;
    this.cartService.applyDiscount(this.code).subscribe({
      next: async coupon => {
        const cart = this.cartService.cart();
        if (cart) {
          cart.coupon = coupon;
          await firstValueFrom(this.cartService.setCart(cart));
          this.code = undefined;
          
          if (this.location.path().includes('/checkout')) {
            await firstValueFrom(this.paystackService.createOrUpdatePaymentTransaction(cart.id));
          }
        }
      }
    });
  }

  async removeCouponCode() {
    const cart = this.cartService.cart();
    if (!cart?.coupon) return;
    
    cart.coupon = undefined;
    await firstValueFrom(this.cartService.setCart(cart));
    
    if (this.location.path().includes('/checkout')) {
      await firstValueFrom(this.paystackService.createOrUpdatePaymentTransaction(cart.id));
    }
  }
}