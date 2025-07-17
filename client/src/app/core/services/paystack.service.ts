import { inject, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Cart } from '../../shared/models/cart';
import { firstValueFrom } from 'rxjs';

// Define the shape of the Paystack popup response
export interface PaystackResponse {
  reference: string;
  trans: string;
  status: string;
  message: string;
  transaction: string;
}

// Define the shape of the Paystack popup options
interface PaystackOptions {
  key: string;
  email: string;
  amount: number; // in the lowest currency unit (kobo/cents)
  ref: string;
  currency: string;
  onClose: () => void;
  callback: (response: PaystackResponse) => void;
}

// This tells TypeScript that a 'PaystackPop' object with a 'setup' method exists on the global window object
declare const PaystackPop: {
  setup(options: PaystackOptions): {
    openIframe: () => void;
  };
};

@Injectable({
  providedIn: 'root'
})
export class PaystackService {
  private http = inject(HttpClient);
  private baseUrl = environment.baseUrl;

  // This method calls our backend to get the payment reference
  createOrUpdatePaymentTransaction(cartId: string) {
    return this.http.post<Cart>(this.baseUrl + 'payments/' + cartId, {});
  }

  // This method configures and opens the Paystack payment popup
  payWithPaystack(options: {
    email: string,
    amount: number, // Total amount in the main currency unit (e.g., USD, ZAR)
    ref: string,
    onSuccess: (response: PaystackResponse) => void,
    onClose: () => void
  }) {
    const paystackOptions: PaystackOptions = {
      key: environment.paystackPublicKey,
      email: options.email,
      amount: options.amount * 100, // Convert to kobo/cents
      ref: options.ref,
      currency: 'ZAR', // Or your desired currency
      onClose: options.onClose,
      callback: options.onSuccess
    };

    PaystackPop.setup(paystackOptions).openIframe();
  }
}