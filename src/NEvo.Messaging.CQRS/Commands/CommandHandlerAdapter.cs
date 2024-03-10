﻿using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Handling;

namespace NEvo.Messaging.CQRS.Commands;

public class CommandHandlerAdapter : MessageHandlerAdapterBase<Command>
{
    public CommandHandlerAdapter(MessageHandlerDescription messageHandlerDescription) : base(messageHandlerDescription)
    {
    }

    protected override async Task<Either<Exception, Unit>> InternalHandleAsync<TCommand>(TCommand command, IMessageContext context, CancellationToken cancellationToken)
    {
        try
        {
            var handler = (ICommandHandler<TCommand>)ActivatorUtilities.CreateInstance(context.ServiceProvider, HandlerDescription.HandlerType);
            return await handler.HandleAsync(command, context, cancellationToken);
        }
        catch (Exception exc)
        {
            Console.WriteLine(exc.Message);
            return exc;
        }
    }
}
