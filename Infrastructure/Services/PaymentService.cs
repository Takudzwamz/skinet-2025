using Core.Entities;
using Core.Interfaces;
using Microsoft.Extensions.Configuration;
using PayStack.Net; // Add this using directive
using Microsoft.AspNetCore.Http;
using System.Security.Claims;

namespace Infrastructure.Services;

public class PaymentService : IPaymentService
{
    private readonly ICartService _cartService;
    private readonly IUnitOfWork _unit;
    private readonly PayStackApi _paystackApi; // Add Paystack API client
    private readonly IHttpContextAccessor _httpContextAccessor;

    public PaymentService(IConfiguration config, ICartService cartService, IUnitOfWork unit, IHttpContextAccessor httpContextAccessor)
    {
        // Initialize Paystack API with your secret key
        var secretKey = config["PaystackSettings:SecretKey"]
            ?? throw new Exception("Paystack secret key not found.");
        _paystackApi = new PayStackApi(secretKey);
        _cartService = cartService;
        _unit = unit;
        _httpContextAccessor = httpContextAccessor;

    }

    public async Task<ShoppingCart?> CreateOrUpdatePaymentTransaction(string cartId)
    {
        var cart = await _cartService.GetCartAsync(cartId)
            ?? throw new Exception("Cart unavailable");

        var shippingPrice = await GetShippingPriceAsync(cart) ?? 0;

        await ValidateCartItemsInCartAsync(cart);

        var subtotal = CalculateSubtotal(cart);

        if (cart.Coupon != null)
        {
            subtotal = ApplyDiscount(cart.Coupon, subtotal);
        }

        // Paystack expects the amount in the lowest currency unit (e.g., kobo, cents)
        var totalInKobo = (subtotal + shippingPrice);

        var email = _httpContextAccessor.HttpContext?.User?.FindFirstValue(ClaimTypes.Email);

        if (string.IsNullOrEmpty(email))
        {
            throw new Exception("User email not found. Cannot create payment transaction.");
        }

        // With Paystack, we initialize a new transaction each time.
        var transactionRequest = new TransactionInitializeRequest
        {
            AmountInKobo = (int)totalInKobo,
            Email = email, // You should get this from the logged-in user
            Reference = Guid.NewGuid().ToString(), // Generate a unique reference
            Currency = "ZAR" // Or any other supported currency
        };

        var transactionResponse = _paystackApi.Transactions.Initialize(transactionRequest);

        if (!transactionResponse.Status)
        {
            throw new Exception($"Paystack transaction failed: {transactionResponse.Message}");
        }

        cart.PaymentReference = transactionResponse.Data.Reference;
        await _cartService.SetCartAsync(cart);

        return cart;
    }

    public Task<string> RefundPayment(string transactionReference)
    {
        var refundResponse = _paystackApi.Post<ApiResponse<object>, object>(
            "/refund",
            new { transaction = transactionReference }
        );

        var resultMessage = refundResponse.Status
            ? "Refund initiated successfully"
            : $"Refund failed: {refundResponse.Message}";

        return Task.FromResult(resultMessage);
    }

    // This method no longer needs to be async or call an external service
    private long ApplyDiscount(AppCoupon appCoupon, long amount)
    {
        // This assumes your AppCoupon has these properties.
        // You may need to fetch coupon details from your own database if not.
        if (appCoupon.AmountOff.HasValue)
        {
            amount -= (long)appCoupon.AmountOff * 100;
        }

        if (appCoupon.PercentOff.HasValue)
        {
            var discount = amount * (appCoupon.PercentOff.Value / 100);
            amount -= (long)discount;
        }

        return amount > 0 ? amount : 0;
    }

    private long CalculateSubtotal(ShoppingCart cart)
    {
        var itemTotal = cart.Items.Sum(x => x.Quantity * x.Price * 100);
        return (long)itemTotal;
    }

    private async Task ValidateCartItemsInCartAsync(ShoppingCart cart)
    {
        foreach (var item in cart.Items)
        {
            var productItem = await _unit.Repository<Product>()
                .GetByIdAsync(item.ProductId)
                    ?? throw new Exception("Problem getting product in cart");

            if (item.Price != productItem.Price)
            {
                item.Price = productItem.Price;
            }
        }
    }

    private async Task<long?> GetShippingPriceAsync(ShoppingCart cart)
    {
        if (cart.DeliveryMethodId.HasValue)
        {
            var deliveryMethod = await _unit.Repository<DeliveryMethod>()
                .GetByIdAsync((int)cart.DeliveryMethodId)
                    ?? throw new Exception("Problem with delivery method");

            return (long)deliveryMethod.Price * 100;
        }

        return null;
    }
}