import { Pipe, PipeTransform } from '@angular/core';
import { PaymentSummary } from '../models/order';

@Pipe({
  name: 'paymentCard'
})
export class PaymentCardPipe implements PipeTransform {
  transform(value?: PaymentSummary): string {
    if (value && 'last4' in value) {
      const { brand, last4, expMonth, expYear } = value;
      return `${brand.toUpperCase()} **** **** **** ${last4}, Exp: ${expMonth}/${expYear}`;
    }
    return 'Payment details will be available after order completion.';
  }
}