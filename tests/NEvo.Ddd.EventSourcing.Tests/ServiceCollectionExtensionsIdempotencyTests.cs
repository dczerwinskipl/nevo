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
        services.Count(d => d.ServiceType == typeof(IDecider) && d.ImplementationType == typeof(AggregateDecider))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IAggregateMethodDecider) && d.ImplementationType == typeof(AggregateDecider))
            .Should().Be(1);
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
    public void AddEventSourcing_IAggregateMethodDecider_IsResolvableThroughDI()
    {
        // IAggregateMethodDecider is the stable public capability an explicit Event
        // Sourced handler delegates to — this proves it resolves. It and IDecider's own
        // registration are deliberately two separate AggregateDecider instances (small,
        // cheap, deterministic setup each), not one shared via a factory alias — the
        // concrete AggregateDecider type itself is never registered, so it is not
        // resolvable as a dependency at all.
        var services = new ServiceCollection();
        services.AddEventSourcing(typeof(Document));
        var provider = services.BuildServiceProvider();

        provider.GetRequiredService<IAggregateMethodDecider>().Should().NotBeNull();
        provider.GetService(typeof(AggregateDecider)).Should().BeNull();
    }
}
