using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using System.Reflection;

namespace NEvo.Messaging.Handling;

public class MessageHandlerAdapter(MessageHandlerDescription messageHandlerDescription, ILogger<MessageHandlerAdapter> logger) : IMessageHandler
{
    private readonly MethodInfo _genericInvokeHandlerAsyncMethod = typeof(MessageHandlerAdapter)
        .GetMethod(nameof(InvokeHandlerAsync), BindingFlags.NonPublic | BindingFlags.Instance)!
        .MakeGenericMethod(messageHandlerDescription.ReturnType!);

    public MessageHandlerDescription HandlerDescription { get; } = messageHandlerDescription;

    public Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
        => (Task<Either<Exception, object>>)_genericInvokeHandlerAsyncMethod.Invoke(this, [message, context, cancellationToken])!;

    private async Task<Either<Exception, object>> InvokeHandlerAsync<TResult>(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var handler = ActivatorUtilities.CreateInstance(context.ServiceProvider, HandlerDescription.HandlerType);
            var resultTask = (Task<Either<Exception, TResult>>)HandlerDescription.Method!.Invoke(handler, [message, context, cancellationToken])!;
            var result = await resultTask;

            return result.Map(value => (object)value!);
        }
        catch (TargetInvocationException exc)
        {
            var innerException = exc.InnerException ?? exc;
            logger.LogError(innerException, "{Message}", innerException.Message);
            return innerException;
        }
        catch (Exception exc)
        {
            logger.LogError(exc, "{Message}", exc.Message);
            return exc;
        }
    }
}
