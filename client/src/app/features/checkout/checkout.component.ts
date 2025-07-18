import { Component, inject, OnInit } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatStepper, MatStepperModule } from "@angular/material/stepper";
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

  // --- SUBMIT ORDER METHOD ---
  async submitOrder(stepper: MatStepper) {
    this.loading = true;
    const currentCart = this.cartService.cart();
    const user = this.accountService.currentUser();
    const totals = this.cartService.totals();

    if (!currentCart || !user || !totals) {
      this.handleError('Cannot proceed, please try again.', stepper);
      return;
    }

    try {
      // Save address if checked
      if (this.addressForm.get('saveAddress')?.value) {
        const addressToSave = this.addressForm.value;
        delete addressToSave.saveAddress;
        await firstValueFrom(this.accountService.updateAddress(addressToSave));
      }

      // Initialize payment to get reference
      const updatedCart = await firstValueFrom(
        this.paystackService.createOrUpdatePaymentTransaction(currentCart.id)
      );
      this.cartService.cart.set(updatedCart);

      // Create the order first to check stock
      const orderToCreateModel = this.createOrderModel();
      const orderResult = await firstValueFrom(this.orderService.createOrder(orderToCreateModel));

      if (!orderResult) {
        throw new Error('Order creation failed');
      }

      // Proceed with payment after successful order creation
      this.paystackService.payWithPaystack({
        email: user.email,
        amount: totals.total,
        ref: orderResult.paymentReference,
        onSuccess: () => {
          this.handleOrderSuccess();
        },
        onClose: () => {
          this.snackbar.info('Payment window closed. Your order is pending payment.');
          this.loading = false;
        }
      });
    } catch (error: any) {
      // The backend error for insufficient stock will be caught and displayed here
      this.handleError(error.error?.message || error.message || 'An error occurred', stepper);
    } finally {
      // We don't set loading to false here because the Paystack modal is now open
    }
  }

  // --- NEW HELPER METHODS ---
  private handleOrderSuccess(): void {
    this.orderService.orderComplete = true;
    this.cartService.deleteCart();
    this.router.navigateByUrl('/checkout/success');
  }

  private handleError(error: any, stepper: MatStepper): void {
    // --- CHANGE THIS ---
    const errorMessage = error.message || 'An error occurred';
    this.snackbar.error(errorMessage);

    // Check if the error object has our out-of-stock data
    if (error.productId && error.quantityInStock !== undefined) {
      // If it's a stock error, redirect the user to their cart
      this.router.navigateByUrl('/cart');
    } else {
      // For any other error, just go back one step
      stepper.previous();
    }

    this.loading = false;
    // -------------------
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