import { Component, inject, Input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { CartService } from '../../../core/services/cart.service';
import { AddressPipe } from '../../../shared/pipes/address-pipe';
import { ShippingAddress } from '../../../shared/models/order'; // Import ShippingAddress

@Component({
  selector: 'app-checkout-review',
  imports: [CurrencyPipe, AddressPipe],
  templateUrl: './checkout-review.component.html',
  styleUrl: './checkout-review.component.scss'
})
export class CheckoutReviewComponent {
  cartService = inject(CartService);
  // Replace confirmationToken with shippingAddress
  @Input() shippingAddress?: ShippingAddress | null;
}