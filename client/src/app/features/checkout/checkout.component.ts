import { Component, inject, OnInit } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatStepperModule } from "@angular/material/stepper";
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AccountService } from '../../core/services/account.service';
import { CartService } from '../../core/services/cart.service';
import { OrderService } from '../../core/services/order.service';
import { PaystackService } from '../../core/services/paystack.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { OrderToCreate, ShippingAddress } from '../../shared/models/order';
import { OrderSummaryComponent } from "../../shared/components/order-summary/order-summary.component";
import { CheckoutDeliveryComponent } from "./checkout-delivery/checkout-delivery.component";
import { CheckoutReviewComponent } from "./checkout-review/checkout-review.component";
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { Country, State, City, ICountry, IState, ICity } from 'country-state-city';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    OrderSummaryComponent,
    CheckoutDeliveryComponent,
    CheckoutReviewComponent,
    MatStepperModule,
    MatCheckboxModule,
    MatButton,
    RouterLink,
    CurrencyPipe,
    MatProgressSpinner,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.scss'
})
export class CheckoutComponent implements OnInit {
  private fb = inject(FormBuilder);
  private accountService = inject(AccountService);
  private snackbar = inject(SnackbarService);
  private router = inject(Router);
  private orderService = inject(OrderService);
  private paystackService = inject(PaystackService);
  cartService = inject(CartService);
  // --- PROPERTIES for address dropdowns ---
  countries: ICountry[] = [];
  states: IState[] = [];
  cities: ICity[] = [];

  // Initialize the form as a property
  checkoutForm: FormGroup = this.fb.group({
    addressForm: this.fb.group({
      name: ['', Validators.required],
      line1: ['', Validators.required],
      line2: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      postalCode: ['', Validators.required],
      country: ['', Validators.required],
      saveAddress: [false] // Add this line
    }),
    deliveryForm: this.fb.group({
      deliveryMethod: ['', Validators.required]
    }),
  });
  loading = false;

  // Add getters for type-safe access in the template
  get addressForm(): FormGroup {
    return this.checkoutForm.get('addressForm') as FormGroup;
  }

  get deliveryForm(): FormGroup {
    return this.checkoutForm.get('deliveryForm') as FormGroup;
  }

  ngOnInit() {
    this.populateAddressForm();
    this.countries = Country.getAllCountries();
  }

  /* populateAddressForm() {
    const user = this.accountService.currentUser();
    if (user?.address) {
      this.addressForm.patchValue(user.address);
    }
  } */

    populateAddressForm() {
  const user = this.accountService.currentUser();
  if (user?.address) {
    // 1. Set the form values with the saved address
    this.addressForm.patchValue(user.address);

    // 2. Manually populate the states and cities based on the saved address
    const countryCode = this.addressForm.get('country')?.value;
    if (countryCode) {
      this.states = State.getStatesOfCountry(countryCode);
      const stateCode = this.addressForm.get('state')?.value;
      if (stateCode) {
        this.cities = City.getCitiesOfState(countryCode, stateCode);
      }
    }
  }
}

  // --- EVENT HANDLERS for dropdowns ---
  onCountryChange(countryCode: string): void {
    // When a country is selected, get its states and reset state/city fields
    this.states = State.getStatesOfCountry(countryCode);
    this.cities = []; // Clear cities
    this.addressForm.get('state')?.setValue('');
    this.addressForm.get('city')?.setValue('');
  }

  onStateChange(countryCode: string, stateCode: string): void {
    // When a state is selected, get its cities and reset city field
    this.cities = City.getCitiesOfState(countryCode, stateCode);
    this.addressForm.get('city')?.setValue('');
  }

  async submitOrder() {
    this.loading = true;
    // Use a local constant for the cart at the start of the operation
    const currentCart = this.cartService.cart();
    const user = this.accountService.currentUser();
    const totals = this.cartService.totals();

    if (!currentCart || !user || !totals) {
      this.snackbar.error('Cannot proceed, please try again');
      this.loading = false;
      return;
    }

    try {


      if (this.addressForm.get('saveAddress')?.value) {
        // The address object is the value of the form
        const addressToSave = this.addressForm.value;
        // We don't need to save the 'saveAddress' boolean itself
        delete addressToSave.saveAddress;
        await firstValueFrom(this.accountService.updateAddress(addressToSave));
      }


      const updatedCart = await firstValueFrom(
        this.paystackService.createOrUpdatePaymentTransaction(currentCart.id)
      );

      // ✅ DEBUG: Add this console log to inspect the data
      console.log('Received from backend:', updatedCart);

      // 2. UPDATE the shared signal in the CartService with the new cart data.
      // This is the critical step that was missing.
      this.cartService.cart.set(updatedCart);

      // 3. Now, create the order model. It will read the updated cart from the service.
      const orderToCreateModel = this.createOrderModel();
      const orderResult = await firstValueFrom(this.orderService.createOrder(orderToCreateModel));

      if (!orderResult || !orderResult.paymentReference) {
        throw new Error('Could not create order');
      }

      // The rest of your logic remains the same
      this.paystackService.payWithPaystack({
        email: user.email,
        amount: totals.total,
        ref: orderResult.paymentReference,
        onSuccess: async () => {
          this.orderService.orderComplete = true;
          this.cartService.deleteCart();
          this.router.navigateByUrl('/checkout/success');
        },
        onClose: () => {
          this.snackbar.info('Payment window closed');
          this.loading = false;
        }
      });
    } catch (error: any) {
      this.snackbar.error(error.error?.message || error.message || 'An error occurred');
      this.loading = false;
    }
  }

  // Your createOrderModel() function is mostly correct, but it relies on a cart
  // that might be deleted too early. We need to get the PaymentReference from the cart.
  private createOrderModel(): OrderToCreate {
    const cart = this.cartService.cart();
    const deliveryMethodId = this.deliveryForm.get('deliveryMethod')?.value;
    const shippingAddress = this.addressForm.value as ShippingAddress;

    if (!cart?.id || !deliveryMethodId || !shippingAddress) {
      throw new Error('Problem with cart, delivery method, or shipping address');
    }

    // Make sure the payment reference exists on the cart before creating the order
    if (!cart.paymentReference) {
      // This shouldn't happen if your checkout flow is correct, but it's a good safeguard.
      // You might need to call `this.paystackService.createOrUpdatePaymentTransaction(cart.id)`
      // earlier in your component lifecycle if `cart.paymentReference` is not yet set.
      // Based on your original code, this reference is created just before payment,
      // so we need to adjust that.
      // Let's assume you call createOrUpdatePaymentTransaction before submitOrder is called.
      throw new Error('Payment reference not found on cart');
    }

    return {
      cartId: cart.id, // The backend uses this to get cart items
      deliveryMethodId: deliveryMethodId,
      shippingAddress: shippingAddress,
      discount: this.cartService.totals()?.discount
    };
  }
}