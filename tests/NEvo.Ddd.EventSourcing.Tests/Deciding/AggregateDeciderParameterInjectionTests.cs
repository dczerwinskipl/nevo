using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Messaging.Context;

namespace NEvo.Ddd.EventSourcing.Tests.Deciding;

// A decision method may declare additional, DI-resolved parameters after the command,
// resolved per-invocation from the current message-context scope — for both the
// static-creation and instance-on-existing-state discovery shapes — while an
// unresolvable type or a misplaced command parameter fail clearly instead of silently.
public class AggregateDeciderParameterInjectionTests
{
    private static (AggregateDecider Decider, ServiceProvider RootProvider, MessageContextAccessor Accessor) CreateDecider(Type aggregateType)
    {
        var services = new ServiceCollection();
        services.AddScoped<IParameterInjectionDependency, ParameterInjectionDependency>();
        services.AddScoped<IActivationThrowingDependency>(_ => throw new InvalidOperationException("Activation always fails for this test dependency."));
        services.AddScoped<ILazyThrowingDependency, LazyThrowingDependency>();
        var rootProvider = services.BuildServiceProvider();

        var configuration = new AggregateExtractorConfiguration { AggregateTypes = { aggregateType } };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        var accessor = new MessageContextAccessor();
        var decider = new AggregateDecider(deciderProvider, accessor);
        return (decider, rootProvider, accessor);
    }

    private static void EnterScope(MessageContextAccessor accessor, IServiceProvider scopedProvider)
        => accessor.MessageContext = new MessageContext(new Dictionary<string, string>(), scopedProvider);

    [Fact]
    public async Task DecideAsync_StaticCreationMethodWithAdditionalParameter_ResolvesDependencyFromCurrentScope()
    {
        var (decider, rootProvider, accessor) = CreateDecider(typeof(ParameterInjectingAggregate));
        using var scope = rootProvider.CreateScope();
        EnterScope(accessor, scope.ServiceProvider);
        var expected = scope.ServiceProvider.GetRequiredService<IParameterInjectionDependency>();

        var result = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.None,
            new CreateParameterInjectingAggregate(Guid.NewGuid()),
            CancellationToken.None);

        var created = result.Should().BeRight().Which.Should().ContainSingle().Which;
        created.Should().BeOfType<ParameterInjectingAggregateCreated>()
            .Which.ResolvedDependencyValue.Should().Be(expected.Value);
    }

    [Fact]
    public async Task DecideAsync_InstanceMethodWithAdditionalParameter_ResolvesDependencyFromCurrentScope()
    {
        var (decider, rootProvider, accessor) = CreateDecider(typeof(ParameterInjectingAggregate));
        using var scope = rootProvider.CreateScope();
        EnterScope(accessor, scope.ServiceProvider);
        var expected = scope.ServiceProvider.GetRequiredService<IParameterInjectionDependency>();
        var id = Guid.NewGuid();

        var result = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.Some(new ParameterInjectingAggregate(id)),
            new MutateParameterInjectingAggregate(id),
            CancellationToken.None);

        var mutated = result.Should().BeRight().Which.Should().ContainSingle().Which;
        mutated.Should().BeOfType<ParameterInjectingAggregateMutated>()
            .Which.ResolvedDependencyValue.Should().Be(expected.Value);
    }

    [Fact]
    public async Task DecideAsync_StaticCreationMethod_ResolvesDifferentValuePerInvocationScope()
    {
        var (decider, rootProvider, accessor) = CreateDecider(typeof(ParameterInjectingAggregate));

        using var firstScope = rootProvider.CreateScope();
        EnterScope(accessor, firstScope.ServiceProvider);
        var firstResult = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.None,
            new CreateParameterInjectingAggregate(Guid.NewGuid()),
            CancellationToken.None);

        using var secondScope = rootProvider.CreateScope();
        EnterScope(accessor, secondScope.ServiceProvider);
        var secondResult = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.None,
            new CreateParameterInjectingAggregate(Guid.NewGuid()),
            CancellationToken.None);

        var firstValue = ((ParameterInjectingAggregateCreated)firstResult.Should().BeRight().Which.Single()).ResolvedDependencyValue;
        var secondValue = ((ParameterInjectingAggregateCreated)secondResult.Should().BeRight().Which.Single()).ResolvedDependencyValue;

        firstValue.Should().NotBe(secondValue);
    }

    [Fact]
    public async Task DecideAsync_InstanceMethod_ResolvesDifferentValuePerInvocationScope()
    {
        var (decider, rootProvider, accessor) = CreateDecider(typeof(ParameterInjectingAggregate));
        var id = Guid.NewGuid();
        var aggregate = new ParameterInjectingAggregate(id);

        using var firstScope = rootProvider.CreateScope();
        EnterScope(accessor, firstScope.ServiceProvider);
        var firstResult = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.Some(aggregate),
            new MutateParameterInjectingAggregate(id),
            CancellationToken.None);

        using var secondScope = rootProvider.CreateScope();
        EnterScope(accessor, secondScope.ServiceProvider);
        var secondResult = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.Some(aggregate),
            new MutateParameterInjectingAggregate(id),
            CancellationToken.None);

        var firstValue = ((ParameterInjectingAggregateMutated)firstResult.Should().BeRight().Which.Single()).ResolvedDependencyValue;
        var secondValue = ((ParameterInjectingAggregateMutated)secondResult.Should().BeRight().Which.Single()).ResolvedDependencyValue;

        firstValue.Should().NotBe(secondValue);
    }

    [Fact]
    public async Task DecideAsync_UnregisteredAdditionalParameterType_FailsWithSpecificError()
    {
        var (decider, rootProvider, accessor) = CreateDecider(typeof(ParameterInjectingAggregate));
        using var scope = rootProvider.CreateScope();
        EnterScope(accessor, scope.ServiceProvider);
        var id = Guid.NewGuid();

        var result = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.Some(new ParameterInjectingAggregate(id)),
            new MutateParameterInjectingAggregateWithUnresolvedDependency(id),
            CancellationToken.None);

        result.Should().BeLeft().Which
            .Should().BeOfType<DecisionMethodParameterResolutionException>().Which
            .Message.Should()
            .Contain(nameof(ParameterInjectingAggregate.MutateWithUnresolvedDependency))
            .And.Contain(nameof(IUnregisteredParameterInjectionDependency));
    }

    // Proves DI activation failures (the registered type's own construction throwing) are
    // caught and represented the same way an unregistered type is — not an uncontrolled
    // exception escaping DI/reflection — with the original exception preserved.
    [Fact]
    public async Task DecideAsync_DependencyActivationThrows_FailsWithSpecificErrorPreservingTheOriginalException()
    {
        var (decider, rootProvider, accessor) = CreateDecider(typeof(ParameterInjectingAggregate));
        using var scope = rootProvider.CreateScope();
        EnterScope(accessor, scope.ServiceProvider);
        var id = Guid.NewGuid();

        var result = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.Some(new ParameterInjectingAggregate(id)),
            new MutateParameterInjectingAggregateWithActivationThrowingDependency(id),
            CancellationToken.None);

        var error = result.Should().BeLeft().Which.Should().BeOfType<DecisionMethodParameterResolutionException>().Which;
        error.Message.Should()
            .Contain(nameof(ParameterInjectingAggregate.MutateWithActivationThrowingDependency))
            .And.Contain(nameof(IActivationThrowingDependency));
        error.InnerException.Should().NotBeNull();
    }

    // A parameter can resolve successfully as a *type* (DI construction succeeds) but
    // still have no current value once the decision method actually reads it — the
    // general mechanism a required contextual capability (e.g. a current-user capability)
    // relies on. Reflection wraps the resulting exception; this proves it surfaces as a
    // Left, not an uncontrolled exception, and — because the method's only statement is
    // the throwing read — no event is ever produced.
    [Fact]
    public async Task DecideAsync_DependencyValueThrowsWhenRead_FailsWithoutProducingAnEvent()
    {
        var (decider, rootProvider, accessor) = CreateDecider(typeof(ParameterInjectingAggregate));
        using var scope = rootProvider.CreateScope();
        EnterScope(accessor, scope.ServiceProvider);
        var id = Guid.NewGuid();

        var result = await decider.DecideAsync<ParameterInjectingAggregate, Guid>(
            Option<ParameterInjectingAggregate>.Some(new ParameterInjectingAggregate(id)),
            new MutateParameterInjectingAggregateWithLazyThrowingDependency(id),
            CancellationToken.None);

        result.Should().BeLeft().Which.Should().BeOfType<InvalidOperationException>()
            .Which.Message.Should().Be("No current value available for this invocation.");
    }

    [Fact]
    public void ExtractDeciders_CommandParameterNotFirst_ThrowsWithASpecificMessage()
    {
        Action act = () => AggregateDeciderExtractor.ExtractDeciders(typeof(MisplacedCommandParameterAggregate)).ToList();

        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"*{nameof(MisplacedCommandParameterAggregate.Create)}*")
            .WithMessage("*first parameter*");
    }
}
