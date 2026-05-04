import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    
    // Fetch stored qualified listings from Supabase
    const { data: listings, error, count } = await supabase
      .from('business_listings')
      .select('*', { count: 'exact' })
      .eq('is_franchise', false)
      .eq('is_design_firm', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Supabase query error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch listings', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      listings: listings || [],
      total: count || 0,
      offset,
      limit
    })

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch listings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Listing ID is required' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('business_listings')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete error:', error)
      return NextResponse.json(
        { error: 'Failed to delete listing', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Listing deleted successfully'
    })

  } catch (error) {
    console.error('Delete API error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to delete listing',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}