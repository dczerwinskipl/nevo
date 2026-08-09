using Microsoft.Extensions.DependencyInjection;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Dispatching;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Strategies;
using NEvo.Messaging.Publishing;

namespace NEvo.Messaging.Cqrs.Tests;

public class ServiceCollectionExtensionsTests
{
    [Fact]
    public void AddCommands_CalledTwice_DoesNotThrow()
    {
        var services = new ServiceCollection();

        var act = () =>
        {
            services.AddCommands();
            services.AddCommands();
        };

        act.Should().NotThrow();
    }

    [Fact]
    public void AddEvents_CalledTwice_DoesNotThrow()
    {
        var services = new ServiceCollection();

        var act = () =>
        {
            services.AddEvents();
            services.AddEvents();
        };

        act.Should().NotThrow();
    }

    [Fact]
    public void AddCommands_CalledTwice_RegistersSingleHandlerFactoryAndStrategy()
    {
        var services = new ServiceCollection();
        services.AddCommands();
        services.AddCommands();

        services.Count(d => d.ServiceType == typeof(IMessageHandlerFactory) && d.ImplementationType == typeof(CommandHandlerAdapterFactory))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageProcessingStrategy) && d.ImplementationType == typeof(CommandProcessingStrategy))
            .Should().Be(1);
    }

    [Fact]
    public void AddEvents_CalledTwice_KeepsBothStrategiesRegisteredExactlyOnce()
    {
        var services = new ServiceCollection();
        services.AddEvents();
        services.AddEvents();

        services.Count(d => d.ServiceType == typeof(IMessageHandlerFactory) && d.ImplementationType == typeof(EventHandlerAdapterFactory))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageProcessingStrategy) && d.ImplementationType == typeof(ParallelEventProcessingStrategy))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageProcessingStrategy) && d.ImplementationType == typeof(SequentialEventProcessingStrategy))
            .Should().Be(1);
    }

    [Fact]
    public void AddMessages_AddCommands_AddEvents_Composed_RegistersEveryExpectedService()
    {
        var services = new ServiceCollection();
        services.AddMessages();
        services.AddCommands();
        services.AddEvents();

        services.Count(d => d.ServiceType == typeof(IMessageHandlerFactory) && d.ImplementationType == typeof(CommandHandlerAdapterFactory))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageHandlerFactory) && d.ImplementationType == typeof(EventHandlerAdapterFactory))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageProcessingStrategy) && d.ImplementationType == typeof(CommandProcessingStrategy))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageProcessingStrategy) && d.ImplementationType == typeof(ParallelEventProcessingStrategy))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageProcessingStrategy) && d.ImplementationType == typeof(SequentialEventProcessingStrategy))
            .Should().Be(1);
        services.Should().ContainSingle(d => d.ServiceType == typeof(ICommandDispatcher));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IMessageDispatchStrategyFactory<Command>));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IEventPublisher));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IMessagePublishStrategyFactory<Event>));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IMessageHandlerProvider));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IMessageHandlerRegistry));
    }
}
