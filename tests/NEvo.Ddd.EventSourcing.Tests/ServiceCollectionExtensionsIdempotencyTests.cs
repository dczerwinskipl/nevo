using Microsoft.Extensions.DependencyInjection;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Handling;

namespace NEvo.Ddd.EventSourcing.Tests;

// AddEventSourcing() called twice must not throw and must not duplicate registered
// services — matching AddCommands/AddEvents/AddQueries's existing idempotency
// precedent (NEvo.Messaging.Cqrs.Tests ServiceCollectionExtensionsTests).
public class ServiceCollectionExtensionsIdempotencyTests
{
    [Fact]
    public void AddEventSourcing_CalledTwice_DoesNotThrow()
    {
        var services = new ServiceCollection();

        var act = () =>
        {
            services.AddEventSourcing(typeof(Document));
            services.AddEventSourcing(typeof(Document));
        };

        act.Should().NotThrow();
    }

    [Fact]
    public void AddEventSourcing_CalledTwice_RegistersEachServiceExactlyOnce()
    {
        var services = new ServiceCollection();
        services.AddEventSourcing(typeof(Document));
        services.AddEventSourcing(typeof(Document));

        services.Count(d => d.ServiceType == typeof(IMessageHandlerProvider) && d.ImplementationType == typeof(DeciderCommandHandlerProvider))
            .Should().Be(1);
        services.Should().ContainSingle(d => d.ServiceType == typeof(AggregateDecider));
        // IDecider/IAggregateMethodDecider are registered via a factory delegating to the
        // AggregateDecider singleton above, not a typed descriptor, so ImplementationType
        // is not checked here.
        services.Count(d => d.ServiceType == typeof(IDecider)).Should().Be(1);
        services.Should().ContainSingle(d => d.ServiceType == typeof(IAggregateMethodDecider));
        services.Count(d => d.ServiceType == typeof(IEvolver) && d.ImplementationType == typeof(AggregateEvolver))
            .Should().Be(1);
        services.Should().ContainSingle(d => d.ServiceType == typeof(IAggregateDeciderProvider));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IEventStreamStore));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IAggregateRepository));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IEvolverRegistry));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IDeciderRegistry));
        services.Should().ContainSingle(d => d.ServiceType == typeof(IEventSourcedCommandExecutor));
    }

    [Fact]
    public void AddEventSourcing_IAggregateMethodDecider_IsResolvableAndSharesTheSameInstanceAsIDecider()
    {
        // IAggregateMethodDecider is the stable public capability an explicit Event
        // Sourced handler delegates to — this proves it resolves, and that it and
        // IDecider's own registration share one physical AggregateDecider instance
        // rather than doing the same discovery/setup work twice.
        var services = new ServiceCollection();
        services.AddEventSourcing(typeof(Document));
        var provider = services.BuildServiceProvider();

        var capability = provider.GetRequiredService<IAggregateMethodDecider>();
        var viaRegistry = provider.GetRequiredService<IDecider>();
        var concrete = provider.GetRequiredService<AggregateDecider>();

        capability.Should().BeSameAs(concrete);
        viaRegistry.Should().BeSameAs(concrete);
    }
}
