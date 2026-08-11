using LanguageExt;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// SUPERSEDED by task 03 (D2, es-command-executor-and-ambiguity-resolution): originally
// characterized today's decider ambiguity resolution (task 01, AC4) as an undetected,
// enumeration-order-dependent first match. Task 03 replaced that mechanism with
// deterministic most-specific-wins resolution (Characterization/AmbiguityResolutionTests.cs,
// MostSpecificDeclaringTypeWins/EquallySpecificCandidates_FailDeterministically). This
// test still passes — for this particular fixture the new algorithm reaches the same
// answer the old first-match happened to reach — but it no longer demonstrates
// "ambiguity": under the new resolver this case is not ambiguous at all, it is a
// correctly-resolved most-specific-wins case. Kept only as a historical record of the
// pre-hardening baseline; task 03's own tests are the ones that gate this area now.
public class AmbiguityResolutionBaselineTests
{
    [Fact]
    public async Task DecideAsync_RuntimeTypeWithTwoCandidateDeclaringTypes_ResolvesWithoutError_PreHardening()
    {
        var configuration = new AggregateExtractorConfiguration { AggregateTypes = { typeof(Document) } };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        var decider = new AggregateDecider(deciderProvider);
        var id = Guid.NewGuid();
        var aggregate = new ReviewableDocument(id, "OldData");

        var result = await decider.DecideAsync<Document, Guid>(
            Option<Document>.Some(aggregate),
            new ChangeDocument(id, "NewData"),
            CancellationToken.None
        );

        // Today's behavior does not detect the ambiguity at all: it silently resolves to
        // whichever of the two candidates the current dictionary/enumeration order
        // produces, rather than failing deterministically. Observed today: the
        // ReviewableDocument candidate wins (visible via its "-Reviewable" suffix) — this
        // happens to match what task 03's most-specific-wins resolution would also pick
        // for this fixture, but today's mechanism reaches it by enumeration order, not by
        // any specificity comparison; task 03's own tests supersede this one once
        // ambiguity resolution becomes deterministic (most-specific wins, tie fails
        // loudly).
        result.Should().BeRight().Which.Should().BeEquivalentTo(
            [new DocumentChanged(id, "NewData-Reviewable")],
            options => options.Excluding(e => e.Id).Excluding(e => e.CreatedAt)
        );
    }
}
