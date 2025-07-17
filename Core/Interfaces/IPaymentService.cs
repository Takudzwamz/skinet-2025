using Core.Entities;

namespace Core.Interfaces;

public interface IPaymentService
{
    Task<ShoppingCart?> CreateOrUpdatePaymentTransaction(string cartId);
    Task<string> RefundPayment(string transactionReference);
}