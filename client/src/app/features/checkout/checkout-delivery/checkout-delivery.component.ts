import { Component, inject, Input, OnInit } from '@angular/core';
import { CurrencyPipe, CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatRadioModule } from "@angular/material/radio";
import { CartService } from '../../../core/services/cart.service';
import { CheckoutService } from '../../../core/services/checkout.service';
import { DeliveryMethod } from '../../../shared/models/deliveryMethod';

@Component({
  selector: 'app-checkout-delivery',
  standalone: true,
  imports: [ CommonModule, MatRadioModule, CurrencyPipe, ReactiveFormsModule ],
  templateUrl: './checkout-delivery.component.html',
  styleUrl: './checkout-delivery.component.scss'
})
export class CheckoutDeliveryComponent implements OnInit {
  @Input() checkoutForm?: FormGroup;
  checkoutService = inject(CheckoutService);
  cartService = inject(CartService);
  deliveryMethods: DeliveryMethod[] = [];

  // Add this getter for type safety
  get deliveryForm(): FormGroup {
    return this.checkoutForm?.get('deliveryForm') as FormGroup;
  }

  ngOnInit() {
    this.checkoutService.getDeliveryMethods().subscribe({
      next: methods => {
        this.deliveryMethods = methods;
      }
    });
  }

  async setShippingPrice(deliveryMethod: DeliveryMethod) {
    await this.cartService.setShippingPrice(deliveryMethod);
  }
}