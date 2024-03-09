using System.Reflection;
using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.CQRS.Commands;

public class CommandHandlerAdapter : IMessageHandler
{
    public MessageHandlerDescription HandlerDescription { get; init; }
    private readonly IServiceProvider _serviceProvider;
    private readonly MethodInfo _genericInternalHandleAsyncMethod;

    public CommandHandlerAdapter(MessageHandlerDescription messageHandlerDescription, IServiceProvider provider)
    {
        HandlerDescription = messageHandlerDescription;
        _serviceProvider = provider;
        _genericInternalHandleAsyncMethod = GetType().GetMethod(nameof(InternalHandleAsync), BindingFlags.NonPublic | BindingFlags.Instance)!.MakeGenericMethod(messageHandlerDescription.MessageType);
    }

    public async Task<Either<Exception, object>> HandleAsync(IMessage message, IMessageContext context, CancellationToken cancellationToken)
    {
        var result = await (Task<Either<Exception, Unit>>)_genericInternalHandleAsyncMethod.Invoke(this, new object[] { message, context, cancellationToken })!;

        var objectResult = result.Map(unit => (object)unit);

        return objectResult;
    }

    private async Task<Either<Exception, Unit>> InternalHandleAsync<TMessage>(TMessage message, IMessageContext context, CancellationToken cancellationToken) where TMessage : Command
    {
        await using var scope = _serviceProvider.CreateAsyncScope();
        try
        {
            var handler = (ICommandHandler<TMessage>)ActivatorUtilities.CreateInstance(scope.ServiceProvider, HandlerDescription.HandlerType);
            return await handler.HandleAsync(message, context, cancellationToken);
        }
        catch (Exception exc)
        {
            Console.WriteLine(exc.Message);
            return exc;
        }
    }
}
