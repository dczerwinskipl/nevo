﻿using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Dispatch;
using NEvo.Messaging.Dispatch.External;
using NEvo.Messaging.Dispatch.Internal;

namespace NEvo.Messaging.Cqrs.Commands;

public class DefaultCommandDispatchStrategyFactory(IServiceProvider serviceProvider) : IMessageDispatchStrategyFactory<Command>
{
    public IMessageDispatchStrategy CreateFor(Command message) =>
        CreateDedicatedServiceFor(message) ?? serviceProvider.GetRequiredService<IMessageDispatchStrategy>();

    private IMessageDispatchStrategy? CreateDedicatedServiceFor(Command message) => 
        IsPrivateMessage(message) ?
            serviceProvider.GetService<IInternalMessageDispatchStrategy>() :
            serviceProvider.GetService<IExternalMessageDispatchStrategy>();

    // TODO: extend it as dependency
    //       can be used like: Attribute, Convention (visiblity, naming), direct configuration
    private static bool IsPrivateMessage(Command message)
    {
        return false;
    }
}
